import type { StoreApi } from 'zustand'
import type { AppState } from '@/store'
import type { WorkingDocument, WorkingDocumentId } from '@/store/slices/editor/working-document'
import { getConnectionIdForFile } from '@/lib/connection-context'
import { readRuntimeFileContent } from '@/runtime/runtime-file-client'
import { settingsForRuntimeOwner } from '@/runtime/runtime-rpc-client'
import { canAutoSaveWorkingDocument } from './editor-autosave'
import { getDiskBaselineSignature } from './diff-content-signature'
import { markWorkingDocumentChangedOnDisk } from './editor-changed-on-disk-mark'

type AppStoreApi = Pick<StoreApi<AppState>, 'getState' | 'subscribe'>

const VERIFY_RETRY_MS = 2_000
const VERIFY_SLOW_RETRY_MS = 15_000
const VERIFY_FAST_ATTEMPTS = 30
const MAX_CONCURRENT_VERIFY_READS = 3

export function attachRestoredTabConflictScan(store: AppStoreApi): () => void {
  const inFlightDocumentIds = new Set<WorkingDocumentId>()
  const attemptsByDocumentId = new Map<WorkingDocumentId, number>()
  const retryTimers = new Set<ReturnType<typeof setTimeout>>()
  const verifyQueue: WorkingDocumentId[] = []
  let activeVerifyReads = 0
  let disposed = false

  const connectionIdForDocument = (document: WorkingDocument): string | undefined => {
    const connectionId =
      getConnectionIdForFile(document.target.worktreeId, document.target.filePath) ?? undefined
    const expected = document.target.externalSshTargetId?.trim()
    if (expected && connectionId !== expected) {
      throw new Error('External SSH file owner changed')
    }
    return connectionId
  }

  const probeDocumentMissing = async (document: WorkingDocument): Promise<boolean> => {
    const settings = settingsForRuntimeOwner(
      store.getState().settings,
      document.target.owner.runtimeEnvironmentId
    )
    if (settings?.activeRuntimeEnvironmentId?.trim()) {
      return false
    }
    try {
      return (
        (await globalThis.window?.api?.fs?.pathExists?.({
          filePath: document.target.filePath,
          connectionId: connectionIdForDocument(document)
        })) === false
      )
    } catch {
      return false
    }
  }

  const verify = async (document: WorkingDocument): Promise<void> => {
    let retryScheduled = false
    try {
      const state = store.getState()
      const result = await readRuntimeFileContent({
        settings: settingsForRuntimeOwner(
          state.settings,
          document.target.owner.runtimeEnvironmentId
        ),
        filePath: document.target.filePath,
        relativePath: document.target.relativePath,
        worktreeId: document.target.worktreeId,
        connectionId: connectionIdForDocument(document),
        expectedExternalSshTargetId: document.target.externalSshTargetId
      })
      if (disposed) {
        return
      }
      const liveDocument = store.getState().workingDocuments[document.id]
      if (!liveDocument) {
        return
      }
      const wasPending = liveDocument.pendingDiskBaselineVerification === true
      store
        .getState()
        .setWorkingDocumentExternalState(document.id, {
          pendingDiskBaselineVerification: undefined
        })
      if (
        !wasPending ||
        result.isBinary ||
        !liveDocument.isDirty ||
        liveDocument.externalMutation === 'changed'
      ) {
        return
      }
      if (getDiskBaselineSignature(result.content) !== liveDocument.lastKnownDiskSignature) {
        markWorkingDocumentChangedOnDisk(store.getState(), liveDocument, { origin: 'restore' })
      }
    } catch {
      if (disposed) {
        return
      }
      if (await probeDocumentMissing(document)) {
        if (disposed) {
          return
        }
        const liveDocument = store.getState().workingDocuments[document.id]
        if (!liveDocument) {
          return
        }
        const wasPending = liveDocument.pendingDiskBaselineVerification === true
        store
          .getState()
          .setWorkingDocumentExternalState(document.id, {
            pendingDiskBaselineVerification: undefined
          })
        if (wasPending && liveDocument.isDirty && liveDocument.externalMutation !== 'changed') {
          store
            .getState()
            .setWorkingDocumentExternalState(document.id, { externalMutation: 'deleted' })
        }
        return
      }
      const attempts = (attemptsByDocumentId.get(document.id) ?? 0) + 1
      attemptsByDocumentId.set(document.id, attempts)
      retryScheduled = true
      const timer = setTimeout(
        () => {
          retryTimers.delete(timer)
          inFlightDocumentIds.delete(document.id)
          scan()
        },
        attempts < VERIFY_FAST_ATTEMPTS ? VERIFY_RETRY_MS : VERIFY_SLOW_RETRY_MS
      )
      retryTimers.add(timer)
    } finally {
      if (!retryScheduled) {
        inFlightDocumentIds.delete(document.id)
      }
    }
  }

  const pumpVerifyQueue = (): void => {
    while (!disposed && activeVerifyReads < MAX_CONCURRENT_VERIFY_READS && verifyQueue.length > 0) {
      const documentId = verifyQueue.shift()!
      const document = store.getState().workingDocuments[documentId]
      if (
        !document ||
        !document.pendingDiskBaselineVerification ||
        !document.isDirty ||
        !document.lastKnownDiskSignature ||
        document.externalMutation === 'changed' ||
        !canAutoSaveWorkingDocument(document)
      ) {
        inFlightDocumentIds.delete(documentId)
        continue
      }
      activeVerifyReads += 1
      const onSettled = (): void => {
        activeVerifyReads -= 1
        pumpVerifyQueue()
      }
      void verify(document).then(onSettled, onSettled)
    }
  }

  const scan = (): void => {
    if (disposed) {
      return
    }
    for (const document of Object.values(store.getState().workingDocuments)) {
      if (
        !document.pendingDiskBaselineVerification ||
        !document.isDirty ||
        !document.lastKnownDiskSignature ||
        document.externalMutation === 'changed' ||
        !canAutoSaveWorkingDocument(document) ||
        inFlightDocumentIds.has(document.id)
      ) {
        continue
      }
      inFlightDocumentIds.add(document.id)
      verifyQueue.push(document.id)
    }
    pumpVerifyQueue()
  }

  let previousDocuments = store.getState().workingDocuments
  const unsubscribe = store.subscribe(() => {
    const nextDocuments = store.getState().workingDocuments
    if (nextDocuments === previousDocuments) {
      return
    }
    previousDocuments = nextDocuments
    scan()
  })
  scan()

  return () => {
    disposed = true
    unsubscribe()
    for (const timer of retryTimers) {
      clearTimeout(timer)
    }
    retryTimers.clear()
    verifyQueue.length = 0
  }
}
