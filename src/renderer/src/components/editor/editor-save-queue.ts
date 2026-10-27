import type { StoreApi } from 'zustand'
import type { AppState } from '@/store'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import { isWorkingDocumentLargePasteInFlight } from './editor-large-paste-in-flight'
import { editorDiscardEpoch } from './editor-discard-epoch'
import {
  canAutoSaveWorkingDocument,
  isAutosaveSuspendedForWorkingDocument,
  normalizeAutoSaveDelayMs
} from './editor-autosave'
import { flushPendingEditorChangeAt } from './editor-pending-flush-registry'
import { releaseNonUtf8PausesWithoutDirtyTab } from './editor-non-utf8-autosave-pause'
import {
  type DocumentSaveTrigger,
  waitForDocumentBaselineRestamp,
  writeWorkingDocument
} from './editor-document-write'

export type AppStoreApi = Pick<StoreApi<AppState>, 'getState' | 'subscribe'>

export type { DocumentSaveTrigger } from './editor-document-write'
export {
  isDocumentBaselineRestampSuperseded,
  trackDocumentBaselineRestamp
} from './editor-document-write'

export type EditorSaveQueue = {
  queueSave: (documentId: WorkingDocumentId, trigger?: DocumentSaveTrigger) => Promise<void>
  quiesceDocumentSave: (documentId: WorkingDocumentId) => Promise<void>
  clearAutoSaveTimer: (documentId: WorkingDocumentId) => void
  bumpSaveGeneration: (documentId: WorkingDocumentId) => void
  syncAutoSave: () => void
  /** Blocks autosave of the document until the returned release runs; holds nest. */
  holdAutoSave: (documentId: WorkingDocumentId) => () => void
  dispose: () => void
}

const pendingDocumentSaves = new Set<WorkingDocumentId>()
const saveSettledListeners = new Set<(documentId: WorkingDocumentId) => void>()

export function isWorkingDocumentSavePending(documentId: WorkingDocumentId): boolean {
  return pendingDocumentSaves.has(documentId)
}

export function subscribeWorkingDocumentSaveSettled(
  listener: (documentId: WorkingDocumentId) => void
): () => void {
  saveSettledListeners.add(listener)
  return () => saveSettledListeners.delete(listener)
}

function notifyWorkingDocumentSaveSettled(documentId: WorkingDocumentId): void {
  for (const listener of saveSettledListeners) {
    listener(documentId)
  }
}

// Save serialization, quiescing and debounce timers share owner-qualified
// document keys. Tabs are deliberately absent: a document can outlive every
// visible surface while a combined diff is virtualized or a write settles.
export function createEditorSaveQueue(store: AppStoreApi): EditorSaveQueue {
  const autoSaveTimers = new Map<WorkingDocumentId, number>()
  const autoSaveScheduledRevisions = new Map<WorkingDocumentId, number>()
  const saveQueue = new Map<WorkingDocumentId, Promise<void>>()
  const saveGeneration = new Map<WorkingDocumentId, number>()
  const autoSaveHolds = new Map<WorkingDocumentId, number>()
  // Why the queue's own store: producers flush only against the revision this queue saves.
  const flushStoreDocument = (documentId: WorkingDocumentId, autosave = false): void =>
    flushPendingEditorChangeAt(
      documentId,
      () => store.getState().workingDocuments[documentId]?.revision,
      undefined,
      autosave
    )

  const clearAutoSaveTimer = (documentId: WorkingDocumentId): void => {
    const timerId = autoSaveTimers.get(documentId)
    if (timerId !== undefined) {
      window.clearTimeout(timerId)
      autoSaveTimers.delete(documentId)
    }
    autoSaveScheduledRevisions.delete(documentId)
  }

  const bumpSaveGeneration = (documentId: WorkingDocumentId): void => {
    saveGeneration.set(documentId, (saveGeneration.get(documentId) ?? 0) + 1)
  }

  const queueSave = (
    documentId: WorkingDocumentId,
    trigger: DocumentSaveTrigger = 'user'
  ): Promise<void> => {
    if (trigger === 'autosave') {
      const document = store.getState().workingDocuments[documentId]
      // A suspended or held autosave must not commit pending producer input either.
      if (
        !document ||
        isAutosaveSuspendedForWorkingDocument(document) ||
        autoSaveHolds.has(documentId)
      ) {
        clearAutoSaveTimer(documentId)
        return Promise.resolve()
      }
    }
    try {
      flushStoreDocument(documentId, trigger === 'autosave')
    } catch (error) {
      // A rejected pending edit (e.g. an invalid CSV cell) blocks this save but keeps the document.
      return Promise.reject(error)
    }
    clearAutoSaveTimer(documentId)
    const queuedGeneration = saveGeneration.get(documentId) ?? 0
    const queuedDiscardEpoch = editorDiscardEpoch(documentId)
    const previousSave = saveQueue.get(documentId) ?? Promise.resolve()

    const queuedSave = previousSave
      .catch(() => undefined)
      .then(async () => {
        if ((saveGeneration.get(documentId) ?? 0) !== queuedGeneration) {
          return
        }
        // Why: a Keep My Edits disk read in flight is about to move the baseline this save guards on.
        await waitForDocumentBaselineRestamp(documentId)

        const state = store.getState()
        const document = state.workingDocuments[documentId]
        if (
          !document ||
          !document.writable ||
          document.loadState !== 'ready' ||
          document.content === undefined
        ) {
          return
        }
        if (document.pendingOwnerMigration === true) {
          if (trigger === 'autosave') {
            return
          }
          throw new Error('This file is still restoring its workspace owner. Try saving again.')
        }
        if (
          trigger === 'autosave' &&
          (isAutosaveSuspendedForWorkingDocument(document) ||
            autoSaveHolds.has(documentId) ||
            // Why: mid-paste text is partial; the completed paste schedules its own save.
            isWorkingDocumentLargePasteInFlight(documentId))
        ) {
          return
        }

        // A clean document has nothing to write; only an explicit Overwrite or Convert forces one.
        if (!document.isDirty && trigger !== 'overwrite' && trigger !== 'convert') {
          return
        }
        await writeWorkingDocument(
          store,
          document,
          trigger,
          () =>
            (saveGeneration.get(documentId) ?? 0) === queuedGeneration &&
            editorDiscardEpoch(documentId) === queuedDiscardEpoch
        )
      })

    let trackedSave: Promise<void>
    pendingDocumentSaves.add(documentId)
    trackedSave = queuedSave.finally(() => {
      if (saveQueue.get(documentId) === trackedSave) {
        saveQueue.delete(documentId)
        pendingDocumentSaves.delete(documentId)
        notifyWorkingDocumentSaveSettled(documentId)
      }
    })
    saveQueue.set(documentId, trackedSave)
    return trackedSave
  }

  const quiesceDocumentSave = async (documentId: WorkingDocumentId): Promise<void> => {
    flushStoreDocument(documentId)
    const pendingSave = saveQueue.get(documentId)
    clearAutoSaveTimer(documentId)
    bumpSaveGeneration(documentId)
    await pendingSave?.catch(() => undefined)
  }

  const syncAutoSave = (): void => {
    const state = store.getState()
    // Close, reload or discard ends paused non-UTF-8 edits; later edits must ask the host again.
    releaseNonUtf8PausesWithoutDirtyTab(
      Object.values(state.workingDocuments).map((document) => ({
        filePath: document.target.filePath,
        runtimeEnvironmentId: document.target.owner.runtimeEnvironmentId,
        isDirty: document.isDirty
      }))
    )
    const autoSaveEnabled = state.settings?.editorAutoSave === true
    for (const documentId of Array.from(autoSaveTimers.keys())) {
      const document = state.workingDocuments[documentId]
      const shouldKeepTimer =
        document &&
        (autoSaveEnabled || document.alwaysAutoSave) &&
        document.isDirty &&
        canAutoSaveWorkingDocument(document) &&
        !isAutosaveSuspendedForWorkingDocument(document) &&
        !autoSaveHolds.has(documentId) &&
        autoSaveScheduledRevisions.get(documentId) === document.revision
      if (!shouldKeepTimer) {
        clearAutoSaveTimer(documentId)
      }
    }

    const autoSaveDelayMs = normalizeAutoSaveDelayMs(state.settings?.editorAutoSaveDelayMs)
    for (const document of Object.values(state.workingDocuments)) {
      if (
        !(autoSaveEnabled || document.alwaysAutoSave) ||
        !document.isDirty ||
        !canAutoSaveWorkingDocument(document) ||
        isAutosaveSuspendedForWorkingDocument(document) ||
        autoSaveHolds.has(document.id)
      ) {
        clearAutoSaveTimer(document.id)
        continue
      }
      if (
        autoSaveTimers.has(document.id) &&
        autoSaveScheduledRevisions.get(document.id) === document.revision
      ) {
        continue
      }
      clearAutoSaveTimer(document.id)
      autoSaveScheduledRevisions.set(document.id, document.revision)
      const timerId = window.setTimeout(() => {
        autoSaveTimers.delete(document.id)
        autoSaveScheduledRevisions.delete(document.id)
        void queueSave(document.id, 'autosave')
      }, autoSaveDelayMs)
      autoSaveTimers.set(document.id, timerId)
    }
  }

  const holdAutoSave = (documentId: WorkingDocumentId): (() => void) => {
    autoSaveHolds.set(documentId, (autoSaveHolds.get(documentId) ?? 0) + 1)
    clearAutoSaveTimer(documentId)
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      const remaining = (autoSaveHolds.get(documentId) ?? 1) - 1
      if (remaining > 0) {
        autoSaveHolds.set(documentId, remaining)
      } else {
        autoSaveHolds.delete(documentId)
      }
      syncAutoSave()
    }
  }

  const dispose = (): void => {
    for (const timerId of autoSaveTimers.values()) {
      window.clearTimeout(timerId)
    }
    autoSaveTimers.clear()
    autoSaveScheduledRevisions.clear()
    saveQueue.clear()
    saveGeneration.clear()
    autoSaveHolds.clear()
    pendingDocumentSaves.clear()
  }

  return {
    queueSave,
    quiesceDocumentSave,
    clearAutoSaveTimer,
    bumpSaveGeneration,
    syncAutoSave,
    holdAutoSave,
    dispose
  }
}
