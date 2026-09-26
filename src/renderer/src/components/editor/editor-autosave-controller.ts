import {
  ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT,
  ORCA_EDITOR_QUIESCE_DOCUMENT_SAVE_EVENT,
  ORCA_EDITOR_REQUEST_DOCUMENT_SAVE_EVENT,
  type EditorDocumentSaveDetail,
  type EditorDocumentSaveQuiesceDetail
} from './editor-autosave'
import {
  autosaveSubscriberInputsEqual,
  getAutosaveSubscriberInputs
} from './editor-autosave-state-projections'
import { createEditorSaveQueue, type AppStoreApi } from './editor-save-queue'
import { createEditorRestartSaveHandlers } from './editor-restart-save-handlers'
import { createEditorExternalChangeDocumentReset } from './editor-external-change-tab-reset'
import {
  ORCA_EDITOR_PREPARE_HOT_EXIT_EVENT,
  ORCA_EDITOR_SAVE_DIRTY_FILES_EVENT
} from '../../../../shared/editor-save-events'

export function attachEditorAutosaveController(store: AppStoreApi): () => void {
  const saveQueue = createEditorSaveQueue(store)
  const { queueSave, quiesceDocumentSave, clearAutoSaveTimer, bumpSaveGeneration, syncAutoSave } =
    saveQueue
  const { handleSaveDirtyFiles, handlePrepareHotExit } = createEditorRestartSaveHandlers({
    store,
    queueSave,
    quiesceDocumentSave
  })
  const handleExternalFileChange = createEditorExternalChangeDocumentReset({
    store,
    clearAutoSaveTimer,
    bumpSaveGeneration
  })

  const handleSaveDocument = async (event: Event): Promise<void> => {
    const detail = (event as CustomEvent<EditorDocumentSaveDetail>).detail
    if (!detail) {
      return
    }
    try {
      detail.claim()
      const document = store.getState().workingDocuments[detail.documentId]
      if (!document || document.content === undefined) {
        detail.resolve()
        return
      }
      await queueSave(detail.documentId)
      detail.resolve()
    } catch (error) {
      detail.reject(String((error as Error)?.message ?? error))
    }
  }

  const handleQuiesce = async (event: Event): Promise<void> => {
    const detail = (event as CustomEvent<EditorDocumentSaveQuiesceDetail>).detail
    if (!detail) {
      return
    }
    detail.claim()
    await quiesceDocumentSave(detail.documentId)
    detail.resolve()
  }

  let previousAutosaveInputs = getAutosaveSubscriberInputs(store.getState())
  const unsubscribe = store.subscribe(() => {
    const nextAutosaveInputs = getAutosaveSubscriberInputs(store.getState())
    if (autosaveSubscriberInputsEqual(previousAutosaveInputs, nextAutosaveInputs)) {
      return
    }
    previousAutosaveInputs = nextAutosaveInputs
    syncAutoSave()
  })
  syncAutoSave()

  window.addEventListener(ORCA_EDITOR_SAVE_DIRTY_FILES_EVENT, handleSaveDirtyFiles as EventListener)
  window.addEventListener(ORCA_EDITOR_PREPARE_HOT_EXIT_EVENT, handlePrepareHotExit as EventListener)
  window.addEventListener(
    ORCA_EDITOR_REQUEST_DOCUMENT_SAVE_EVENT,
    handleSaveDocument as EventListener
  )
  window.addEventListener(ORCA_EDITOR_QUIESCE_DOCUMENT_SAVE_EVENT, handleQuiesce as EventListener)
  window.addEventListener(
    ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT,
    handleExternalFileChange as EventListener
  )

  return () => {
    unsubscribe()
    window.removeEventListener(
      ORCA_EDITOR_SAVE_DIRTY_FILES_EVENT,
      handleSaveDirtyFiles as EventListener
    )
    window.removeEventListener(
      ORCA_EDITOR_PREPARE_HOT_EXIT_EVENT,
      handlePrepareHotExit as EventListener
    )
    window.removeEventListener(
      ORCA_EDITOR_REQUEST_DOCUMENT_SAVE_EVENT,
      handleSaveDocument as EventListener
    )
    window.removeEventListener(
      ORCA_EDITOR_QUIESCE_DOCUMENT_SAVE_EVENT,
      handleQuiesce as EventListener
    )
    window.removeEventListener(
      ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT,
      handleExternalFileChange as EventListener
    )
    saveQueue.dispose()
  }
}
