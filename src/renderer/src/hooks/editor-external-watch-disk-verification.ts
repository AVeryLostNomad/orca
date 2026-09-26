import { useAppStore } from '@/store'
import type { WorkingDocument, WorkingDocumentId } from '@/store/slices/editor/working-document'
import { notifyEditorExternalFileChange } from '@/components/editor/editor-autosave'
import { markWorkingDocumentChangedOnDisk } from '@/components/editor/editor-changed-on-disk-mark'
import { getDiskBaselineSignature } from '@/components/editor/diff-content-signature'
import {
  clearSelfWrite,
  getRecentSelfWrite,
  type RecentSelfWrite
} from '@/components/editor/editor-self-write-registry'
import { readRuntimeFileContent } from '@/runtime/runtime-file-client'
import type { EditorExternalWatchTarget } from './editor-external-watch-targets'

export type EditorExternalWatchNotification = {
  worktreeId: string
  worktreePath: string
  relativePath: string
  runtimeEnvironmentId: string | null
  allowLocalWindowsWslAliases?: true
}

const EXTERNAL_RELOAD_DEBOUNCE_MS = 75
const pendingExternalReloadTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function scheduleDebouncedEditorExternalReload(
  notification: EditorExternalWatchNotification
): void {
  const key = `${notification.worktreeId}::${notification.runtimeEnvironmentId ?? 'client'}::${notification.relativePath}`
  const existing = pendingExternalReloadTimers.get(key)
  if (existing !== undefined) {
    globalThis.clearTimeout(existing)
  }
  const handle = globalThis.setTimeout(() => {
    pendingExternalReloadTimers.delete(key)
    notifyEditorExternalFileChange(notification)
  }, EXTERNAL_RELOAD_DEBOUNCE_MS)
  pendingExternalReloadTimers.set(key, handle)
}

const inFlightEchoVerificationReads = new Map<
  WorkingDocumentId,
  ReturnType<typeof readRuntimeFileContent>
>()

function readDocumentForEchoVerification(
  document: WorkingDocument,
  connectionId: string | undefined
): ReturnType<typeof readRuntimeFileContent> {
  let pending = inFlightEchoVerificationReads.get(document.id)
  if (!pending) {
    pending = readRuntimeFileContent({
      settings: document.target.owner.runtimeEnvironmentId
        ? { activeRuntimeEnvironmentId: document.target.owner.runtimeEnvironmentId }
        : null,
      filePath: document.target.filePath,
      relativePath: document.target.relativePath,
      worktreeId: document.target.worktreeId,
      connectionId,
      expectedExternalSshTargetId: document.target.externalSshTargetId
    })
    inFlightEchoVerificationReads.set(document.id, pending)
    const release = (): void => {
      if (inFlightEchoVerificationReads.get(document.id) === pending) {
        inFlightEchoVerificationReads.delete(document.id)
      }
    }
    pending.then(release, release)
  }
  return pending
}

function markDocumentsChangedOnDisk(documentIds: readonly WorkingDocumentId[]): void {
  const state = useAppStore.getState()
  for (const documentId of documentIds) {
    const document = state.workingDocuments[documentId]
    if (document) {
      markWorkingDocumentChangedOnDisk(state, document, { origin: 'live' })
    }
  }
}

export function scheduleEditorChangedOnDiskMark(
  target: EditorExternalWatchTarget,
  documentIds: readonly WorkingDocumentId[]
): void {
  for (const documentId of documentIds) {
    const document = useAppStore.getState().workingDocuments[documentId]
    if (!document) {
      continue
    }
    const recentSelfWrite = getRecentSelfWrite(documentId)
    if (!recentSelfWrite) {
      markDocumentsChangedOnDisk([documentId])
      continue
    }
    void readDocumentForEchoVerification(document, target.connectionId)
      .then((result) => {
        if (result.isBinary || result.content !== recentSelfWrite.content) {
          markDocumentsChangedOnDisk([documentId])
        }
      })
      .catch(() => markDocumentsChangedOnDisk([documentId]))
  }
}

const liveMoveVerifyGeneration = new Map<WorkingDocumentId, number>()
let liveMoveVerifyCounter = 0

type LiveMoveVerifyCandidate = {
  documentId: WorkingDocumentId
  baseline: string | undefined
  generation: number
  operationId?: string
}

function resolveLiveMoveVerification(
  candidate: LiveMoveVerifyCandidate,
  diskSignature: string | null,
  consumeProvenance: boolean
): void {
  const { documentId, baseline, generation, operationId } = candidate
  if (liveMoveVerifyGeneration.get(documentId) !== generation) {
    return
  }
  liveMoveVerifyGeneration.delete(documentId)
  const state = useAppStore.getState()
  const document = state.workingDocuments[documentId]
  if (!document) {
    return
  }
  state.setWorkingDocumentExternalState(documentId, { pendingLiveDiskVerification: undefined })
  if (
    !document.isDirty ||
    document.externalMutation === 'changed' ||
    document.lastKnownDiskSignature !== baseline ||
    (operationId !== undefined && document.pendingSelfMoveEcho?.operationId !== operationId)
  ) {
    return
  }
  if (consumeProvenance) {
    state.setWorkingDocumentExternalState(documentId, { pendingSelfMoveEcho: undefined })
  }
  if (baseline === undefined || diskSignature !== baseline) {
    markWorkingDocumentChangedOnDisk(state, document, { origin: 'live' })
  }
}

export function verifyLatchedEditorMoveDestinations(
  connectionId: string | undefined,
  documentIds: readonly WorkingDocumentId[]
): void {
  scheduleEditorSelfMoveEchoVerification(connectionId, documentIds, false)
}

export function scheduleEditorSelfMoveEchoVerification(
  connectionId: string | undefined,
  documentIds: readonly WorkingDocumentId[],
  consumeProvenance: boolean
): void {
  const state = useAppStore.getState()
  for (const documentId of documentIds) {
    const document = state.workingDocuments[documentId]
    if (!document || !document.isDirty || document.externalMutation === 'changed') {
      continue
    }
    const generation = ++liveMoveVerifyCounter
    liveMoveVerifyGeneration.set(documentId, generation)
    state.setWorkingDocumentExternalState(documentId, { pendingLiveDiskVerification: true })
    const candidate: LiveMoveVerifyCandidate = {
      documentId,
      baseline: document.lastKnownDiskSignature,
      generation,
      operationId: document.pendingSelfMoveEcho?.operationId
    }
    void readDocumentForEchoVerification(document, connectionId)
      .then((result) =>
        resolveLiveMoveVerification(
          candidate,
          result.isBinary ? null : getDiskBaselineSignature(result.content),
          consumeProvenance
        )
      )
      .catch(() => resolveLiveMoveVerification(candidate, null, consumeProvenance))
  }
}

export function scheduleSelfWriteAwareEditorExternalReload(
  target: EditorExternalWatchTarget,
  notification: EditorExternalWatchNotification,
  document: WorkingDocument,
  recentSelfWrite: RecentSelfWrite
): void {
  void readDocumentForEchoVerification(document, target.connectionId)
    .then((result) => {
      if (result.isBinary || result.content !== recentSelfWrite.content) {
        clearSelfWrite(document.id)
        scheduleDebouncedEditorExternalReload(notification)
      }
    })
    .catch(() => {
      clearSelfWrite(document.id)
      scheduleDebouncedEditorExternalReload(notification)
    })
}
