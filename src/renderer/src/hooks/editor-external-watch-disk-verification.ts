import { useAppStore } from '@/store'
import type { WorkingDocument, WorkingDocumentId } from '@/store/slices/editor/working-document'
import { notifyEditorExternalFileChange } from '@/components/editor/editor-autosave'
import { markWorkingDocumentChangedOnDisk } from '@/components/editor/editor-changed-on-disk-mark'
import { getDiskBaselineSignature } from '../../../shared/disk-baseline-signature'
import {
  clearSelfWrite,
  getRecentSelfWrite,
  type RecentSelfWrite
} from '@/components/editor/editor-self-write-registry'
import { readRuntimeFileContent } from '@/runtime/runtime-file-read-client'
import type { EditorExternalWatchTarget } from './editor-external-watch-targets'
import { runtimeTargetForOwnerEnvironment } from '@/runtime/runtime-client-target'

export type EditorExternalWatchNotification = {
  worktreeId: string
  worktreePath: string
  relativePath: string
  runtimeEnvironmentId: string | null
  allowLocalWindowsWslAliases?: true
}

// Coalesce atomic-write reload bursts per owner/path to prevent EditorPanel fan-out (#826); never postpone an armed dispatch under sustained writes.
const EXTERNAL_RELOAD_DEBOUNCE_MS = 75
const pendingExternalReloads = new Map<string, EditorExternalWatchNotification>()

export function scheduleDebouncedEditorExternalReload(
  notification: EditorExternalWatchNotification
): void {
  const key = `${notification.worktreeId}::${notification.runtimeEnvironmentId ?? 'client'}::${notification.relativePath}`
  const armed = pendingExternalReloads.has(key)
  pendingExternalReloads.set(key, notification)
  if (armed) {
    return
  }
  globalThis.setTimeout(() => {
    const latest = pendingExternalReloads.get(key)
    pendingExternalReloads.delete(key)
    if (latest) {
      notifyEditorExternalFileChange(latest)
    }
  }, EXTERNAL_RELOAD_DEBOUNCE_MS)
}

type EchoVerificationRead = ReturnType<typeof readRuntimeFileContent>
type EchoVerificationSlot = {
  current: EchoVerificationRead
  /** Payloads in the task that issued `current` were emitted before the read reached disk. */
  joinable: boolean
  next: EchoVerificationRead | null
}
const echoVerificationReads = new Map<string, EchoVerificationSlot>()

function beginEchoVerificationRead(
  key: string,
  read: () => EchoVerificationRead
): EchoVerificationRead {
  const current = read()
  const slot: EchoVerificationSlot = { current, joinable: true, next: null }
  echoVerificationReads.set(key, slot)
  queueMicrotask(() => {
    slot.joinable = false
  })
  const release = (): void => {
    if (echoVerificationReads.get(key) === slot && !slot.next) {
      echoVerificationReads.delete(key)
    }
  }
  current.then(release, release)
  return current
}

// Share burst echo reads, but queue one fresh read for later-task events that the in-flight disk snapshot may have missed.
function readDocumentForEchoVerification(
  document: WorkingDocument,
  connectionId: string | undefined
): EchoVerificationRead {
  const key = [document.id, connectionId ?? ''].join('::')
  const read = (): EchoVerificationRead =>
    readRuntimeFileContent({
      target: runtimeTargetForOwnerEnvironment(document.target.owner.runtimeEnvironmentId),
      filePath: document.target.filePath,
      relativePath: document.target.relativePath,
      worktreeId: document.target.worktreeId,
      connectionId,
      expectedExternalSshTargetId: document.target.externalSshTargetId
    })
  const slot = echoVerificationReads.get(key)
  if (!slot) {
    return beginEchoVerificationRead(key, read)
  }
  if (slot.joinable) {
    return slot.current
  }
  slot.next ??= slot.current.then(
    () => beginEchoVerificationRead(key, read),
    () => beginEchoVerificationRead(key, read)
  )
  return slot.next
}

function markDocumentsChangedOnDisk(documentIds: readonly WorkingDocumentId[]): void {
  const state = useAppStore.getState()
  for (const documentId of documentIds) {
    // Async echo verification may outlive the document; mark only retained ones.
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
    // Verify disk differs from the last save before labeling its watcher echo an external change.
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
      // Unreadable disk cannot disprove conflict; keep it visible instead of risking silent overwrite.
      .catch(() => markDocumentsChangedOnDisk([documentId]))
  }
}

// Per-document generation so a newer echo-verify read supersedes an older one's stale verdict.
const liveMoveVerifyGeneration = new Map<WorkingDocumentId, number>()
let liveMoveVerifyCounter = 0

type LiveMoveVerifyCandidate = {
  documentId: WorkingDocumentId
  baseline: string | undefined
  generation: number
  operationId?: string
}

// Fails closed: `false` (anything but a proven match) surfaces the conflict; `null` (unread, on a resync) proves nothing.
function resolveLiveMoveVerification(
  candidate: LiveMoveVerifyCandidate,
  matchesDisk: boolean | null,
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
  if (matchesDisk === false) {
    markWorkingDocumentChangedOnDisk(state, document, { origin: 'live' })
  }
}

export function verifyLatchedEditorMoveDestinations(
  connectionId: string | undefined,
  documentIds: readonly WorkingDocumentId[]
): void {
  scheduleEditorSelfMoveEchoVerification(connectionId, documentIds, false)
}

/** `resync`: a watch reconnect check, where a failed read leaves the document to its guarded save. */
export function scheduleEditorSelfMoveEchoVerification(
  connectionId: string | undefined,
  documentIds: readonly WorkingDocumentId[],
  consumeProvenance: boolean,
  resync = false
): void {
  const state = useAppStore.getState()
  for (const documentId of documentIds) {
    const document = state.workingDocuments[documentId]
    if (!document || !document.isDirty || document.externalMutation === 'changed') {
      continue
    }
    const generation = ++liveMoveVerifyCounter
    liveMoveVerifyGeneration.set(documentId, generation)
    // Gate autosave until disk is compared so a stale baseline can't overwrite an external write.
    state.setWorkingDocumentExternalState(documentId, { pendingLiveDiskVerification: true })
    const candidate: LiveMoveVerifyCandidate = {
      documentId,
      baseline: document.lastKnownDiskSignature,
      generation,
      operationId: document.pendingSelfMoveEcho?.operationId
    }
    void readDocumentForEchoVerification(document, connectionId)
      .then((result) => {
        const matchesDisk =
          !result.isBinary &&
          ((candidate.baseline !== undefined &&
            getDiskBaselineSignature(result.content) === candidate.baseline) ||
            // The document's own save can land before it rebaselines; that is not an external change.
            getRecentSelfWrite(documentId)?.content === result.content)
        resolveLiveMoveVerification(candidate, matchesDisk, consumeProvenance)
      })
      .catch(() =>
        resolveLiveMoveVerification(candidate, resync ? null : false, consumeProvenance)
      )
  }
}

export function scheduleSelfWriteAwareEditorExternalReload(
  target: EditorExternalWatchTarget,
  notification: EditorExternalWatchNotification,
  document: WorkingDocument,
  recentSelfWrite: RecentSelfWrite
): void {
  // Self-write TTL proves recency only; compare content so newer agent writes within it still surface.
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
