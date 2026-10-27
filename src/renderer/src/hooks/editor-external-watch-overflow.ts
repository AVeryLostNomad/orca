import { useAppStore } from '@/store'
import type { WorkingDocument, WorkingDocumentId } from '@/store/slices/editor/working-document'
import type { EditorExternalWatchBatchPathIndex } from '@/components/editor/editor-external-watch-path-index'
import { isExternalReloadableEditorTab } from '@/components/editor/editor-autosave'
import { forgetCombinedDiffViewBodiesForWorktree } from '@/components/editor/combined-diff/remember-view/combined-diff-view-cache'
import { getRuntimeTargetForFileOwner } from '@/lib/file-owner-runtime-target'
import { runtimePathsExist } from '@/runtime/runtime-path-existence-batch'
import {
  PATH_EXISTENCE_BATCH_MAX,
  type PathExistenceResult
} from '../../../shared/path-existence-batch'
import {
  getLocalWindowsWslAliasOption,
  getOpenFileRuntimeOwner,
  type EditorExternalWatchTarget
} from './editor-external-watch-targets'
import {
  scheduleDebouncedEditorExternalReload,
  scheduleEditorSelfMoveEchoVerification,
  type EditorExternalWatchNotification
} from './editor-external-watch-disk-verification'

// An existence answer is stale once a newer probe or watch event for that document arrives.
const probeGenerationByDocumentId = new Map<WorkingDocumentId, number>()
let probeGenerationSeq = 0

function claimProbeGeneration(documentId: WorkingDocumentId): number {
  probeGenerationSeq += 1
  probeGenerationByDocumentId.set(documentId, probeGenerationSeq)
  return probeGenerationSeq
}

export function getPendingOverflowProbeCountForTest(): number {
  return probeGenerationByDocumentId.size
}

/** Drops pending existence answers for documents this watch batch touched. */
export function supersedeOverflowProbesForBatch(
  batchPaths: EditorExternalWatchBatchPathIndex,
  workingDocuments: Readonly<Record<WorkingDocumentId, WorkingDocument>>
): void {
  if (probeGenerationByDocumentId.size === 0) {
    return
  }
  const touched = new Set(batchPaths.deletedWorkingDocuments.map(({ documentId }) => documentId))
  for (const change of batchPaths.changes) {
    for (const documentId of batchPaths.matchingDocumentIds(change)) {
      touched.add(documentId)
    }
  }
  for (const documentId of probeGenerationByDocumentId.keys()) {
    const document = workingDocuments[documentId]
    if (document && batchPaths.matchesCreateOrUpdate(document)) {
      touched.add(documentId)
    }
  }
  for (const documentId of touched) {
    probeGenerationByDocumentId.delete(documentId)
  }
}

type OverflowTarget = Pick<EditorExternalWatchTarget, 'worktreeId' | 'worktreePath'> &
  Partial<
    Pick<
      EditorExternalWatchTarget,
      'connectionId' | 'runtimeEnvironmentId' | 'allowLocalWindowsWslAliases'
    >
  >

type DocumentProbe = {
  documentId: WorkingDocumentId
  generation: number
  filePath: string
  notification: EditorExternalWatchNotification
}

function notificationFor(
  target: OverflowTarget,
  relativePath: string
): EditorExternalWatchNotification {
  return {
    worktreeId: target.worktreeId,
    worktreePath: target.worktreePath,
    relativePath,
    runtimeEnvironmentId: target.runtimeEnvironmentId ?? null,
    ...getLocalWindowsWslAliasOption(target)
  }
}

/** Overflow reloads clean workspace documents; reconnect resync also probes deletions, while event-storm overflow avoids per-file probe fan-out. */
export function reconcileEditorTabsAfterOverflow(target: OverflowTarget, resync: boolean): void {
  if (resync) {
    // Invalidate bodies for unmounted combined diffs too, before remount can replay stale cached content.
    forgetCombinedDiffViewBodiesForWorktree(target.worktreeId)
  }
  const state = useAppStore.getState()
  const owner = target.runtimeEnvironmentId ?? null
  const documentPaths = new Set<string>()
  const probes: DocumentProbe[] = []
  for (const document of Object.values(state.workingDocuments)) {
    if (
      document.target.worktreeId !== target.worktreeId ||
      document.target.owner.runtimeEnvironmentId !== owner
    ) {
      continue
    }
    documentPaths.add(document.target.relativePath)
    // Compare dirty documents asynchronously; autosave stays free to run its own guarded check.
    if (document.isDirty) {
      if (resync) {
        scheduleEditorSelfMoveEchoVerification(target.connectionId, [document.id], false, true)
      }
      continue
    }
    const notification = notificationFor(target, document.target.relativePath)
    if (!resync) {
      // This reload is newer than any pending resync probe for the document.
      probeGenerationByDocumentId.delete(document.id)
      if (document.externalMutation) {
        state.setWorkingDocumentExternalState(document.id, { externalMutation: undefined })
      }
      scheduleDebouncedEditorExternalReload(notification)
      continue
    }
    probes.push({
      documentId: document.id,
      generation: claimProbeGeneration(document.id),
      filePath: document.target.filePath,
      notification
    })
  }
  // Clean views without a working document (staged diffs, previews) reload by path.
  for (const file of state.openFiles) {
    if (
      file.worktreeId === target.worktreeId &&
      getOpenFileRuntimeOwner(file) === owner &&
      isExternalReloadableEditorTab(file) &&
      !file.isDirty &&
      !documentPaths.has(file.relativePath)
    ) {
      scheduleDebouncedEditorExternalReload(notificationFor(target, file.relativePath))
    }
  }
  if (probes.length > 0) {
    void reloadDocumentsUnlessGone(target, probes)
  }
}

async function probeDocuments(
  target: OverflowTarget,
  probes: readonly DocumentProbe[]
): Promise<readonly PathExistenceResult[] | null> {
  const owner = getRuntimeTargetForFileOwner(
    useAppStore.getState(),
    target.worktreeId,
    target.runtimeEnvironmentId ?? null
  )
  if (!owner) {
    return null
  }
  const context = {
    target: owner,
    worktreeId: target.worktreeId,
    worktreePath: target.worktreePath,
    connectionId: target.connectionId
  }
  const paths = probes.map((probe) => probe.filePath)
  // The host rejects a batch above its limit outright, which would reload every document.
  const chunks: string[][] = []
  for (let start = 0; start < paths.length; start += PATH_EXISTENCE_BATCH_MAX) {
    chunks.push(paths.slice(start, start + PATH_EXISTENCE_BATCH_MAX))
  }
  try {
    const results = await Promise.all(
      chunks.map((chunk) =>
        // A whole-request "not found" (worktree re-pairing) must never mark every document deleted.
        runtimePathsExist(context, chunk, undefined, { codedAbsenceOnly: true })
      )
    )
    return results.flat()
  } catch {
    // A failed probe cannot prove absence; reload as before.
    return null
  }
}

// Mark confirmed deletions instead of replacing last-known content with read errors.
async function reloadDocumentsUnlessGone(
  target: OverflowTarget,
  probes: readonly DocumentProbe[]
): Promise<void> {
  const results = await probeDocuments(target, probes)
  const state = useAppStore.getState()
  probes.forEach((probe, index) => {
    if (probeGenerationByDocumentId.get(probe.documentId) !== probe.generation) {
      return
    }
    probeGenerationByDocumentId.delete(probe.documentId)
    const live = state.workingDocuments[probe.documentId]
    if (!live || live.isDirty) {
      return
    }
    const row = results?.[index]
    if (row && 'exists' in row && !row.exists) {
      // Keep a rename mark; without watch events a rename and a delete look the same.
      if (live.externalMutation !== 'deleted' && live.externalMutation !== 'renamed') {
        state.setWorkingDocumentExternalState(live.id, { externalMutation: 'deleted' })
      }
      return
    }
    if (live.externalMutation) {
      state.setWorkingDocumentExternalState(live.id, { externalMutation: undefined })
    }
    scheduleDebouncedEditorExternalReload(probe.notification)
  })
}
