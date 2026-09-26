import type { StoreApi } from 'zustand'
import type { AppState } from '@/store'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { writeRuntimeFile } from '@/runtime/runtime-file-client'
import { getEditorFileOperationContext } from '@/lib/editor-file-operation-owner'
import {
  canAutoSaveWorkingDocument,
  isAutosaveSuspendedForWorkingDocument,
  normalizeAutoSaveDelayMs,
  ORCA_EDITOR_DOCUMENT_SAVED_EVENT,
  type EditorDocumentSavedDetail
} from './editor-autosave'
import { flushPendingEditorChange } from './editor-pending-flush'
import {
  clearSelfWrite,
  recordSelfWrite,
  SELF_WRITE_REMOTE_TTL_MS
} from './editor-self-write-registry'
import { getDiskBaselineSignature } from './diff-content-signature'

export type AppStoreApi = Pick<StoreApi<AppState>, 'getState' | 'subscribe'>

export type EditorSaveQueue = {
  queueSave: (documentId: WorkingDocumentId, trigger?: 'autosave' | 'user') => Promise<void>
  quiesceDocumentSave: (documentId: WorkingDocumentId) => Promise<void>
  clearAutoSaveTimer: (documentId: WorkingDocumentId) => void
  bumpSaveGeneration: (documentId: WorkingDocumentId) => void
  syncAutoSave: () => void
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
    trigger: 'autosave' | 'user' = 'user'
  ): Promise<void> => {
    flushPendingEditorChange(documentId)
    clearAutoSaveTimer(documentId)
    const queuedGeneration = saveGeneration.get(documentId) ?? 0
    const previousSave = saveQueue.get(documentId) ?? Promise.resolve()

    const queuedSave = previousSave
      .catch(() => undefined)
      .then(async () => {
        if ((saveGeneration.get(documentId) ?? 0) !== queuedGeneration) {
          return
        }

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
        if (trigger === 'autosave' && isAutosaveSuspendedForWorkingDocument(document)) {
          return
        }

        const contentToSave = document.content
        const worktree = findWorktreeById(state.worktreesByRepo ?? {}, document.target.worktreeId)
        const fileContext = getEditorFileOperationContext(
          state,
          {
            worktreeId: document.target.worktreeId,
            runtimeEnvironmentId: document.target.owner.runtimeEnvironmentId,
            externalSshTargetId: document.target.externalSshTargetId,
            operationProvenance: document.target.operationProvenance
          },
          worktree?.path ?? null
        )
        const remoteWrite = Boolean(
          fileContext.connectionId || document.target.owner.runtimeEnvironmentId
        )
        recordSelfWrite(
          documentId,
          contentToSave,
          remoteWrite ? SELF_WRITE_REMOTE_TTL_MS : undefined
        )
        try {
          await writeRuntimeFile(fileContext, document.target.filePath, contentToSave)
        } catch (error) {
          clearSelfWrite(documentId)
          throw error
        }

        const savedSignature = getDiskBaselineSignature(contentToSave)
        const nextState = store.getState()
        nextState.commitWorkingDocumentSave(documentId, contentToSave, savedSignature)
        const savedDocument = nextState.workingDocuments[documentId]
        if (!savedDocument) {
          return
        }
        window.dispatchEvent(
          new CustomEvent<EditorDocumentSavedDetail>(ORCA_EDITOR_DOCUMENT_SAVED_EVENT, {
            detail: {
              documentId,
              owner: savedDocument.target.owner,
              filePath: savedDocument.target.filePath,
              content: contentToSave
            }
          })
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
    flushPendingEditorChange(documentId)
    const pendingSave = saveQueue.get(documentId)
    clearAutoSaveTimer(documentId)
    bumpSaveGeneration(documentId)
    await pendingSave?.catch(() => undefined)
  }

  const syncAutoSave = (): void => {
    const state = store.getState()
    const autoSaveEnabled = state.settings?.editorAutoSave === true
    for (const documentId of Array.from(autoSaveTimers.keys())) {
      const document = state.workingDocuments[documentId]
      const shouldKeepTimer =
        document &&
        (autoSaveEnabled || document.alwaysAutoSave) &&
        document.isDirty &&
        canAutoSaveWorkingDocument(document) &&
        !isAutosaveSuspendedForWorkingDocument(document) &&
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
        isAutosaveSuspendedForWorkingDocument(document)
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

  const dispose = (): void => {
    for (const timerId of autoSaveTimers.values()) {
      window.clearTimeout(timerId)
    }
    autoSaveTimers.clear()
    autoSaveScheduledRevisions.clear()
    saveQueue.clear()
    saveGeneration.clear()
    pendingDocumentSaves.clear()
  }

  return {
    queueSave,
    quiesceDocumentSave,
    clearAutoSaveTimer,
    bumpSaveGeneration,
    syncAutoSave,
    dispose
  }
}
