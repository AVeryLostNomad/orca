import { shouldPersistWorkspaceSession } from '@/lib/workspace-session'
import { canAutoSaveWorkingDocument } from './editor-autosave'
import { flushPendingEditorChange } from './editor-pending-flush'
import type { AppStoreApi, EditorSaveQueue } from './editor-save-queue'
import type {
  EditorPrepareHotExitDetail,
  EditorSaveDirtyFilesDetail
} from '../../../../shared/editor-save-events'

type EditorRestartSaveHandlerOptions = {
  store: AppStoreApi
  queueSave: EditorSaveQueue['queueSave']
  quiesceDocumentSave: EditorSaveQueue['quiesceDocumentSave']
}

export function createEditorRestartSaveHandlers({
  store,
  queueSave,
  quiesceDocumentSave
}: EditorRestartSaveHandlerOptions): {
  handleSaveDirtyFiles: (event: Event) => Promise<void>
  handlePrepareHotExit: (event: Event) => Promise<void>
} {
  const getDirtyDocuments = () =>
    Object.values(store.getState().workingDocuments).filter((document) => document.isDirty)

  const handleSaveDirtyFiles = async (event: Event): Promise<void> => {
    const detail = (event as CustomEvent<EditorSaveDirtyFilesDetail>).detail
    if (!detail) {
      return
    }
    try {
      detail.claim()
      for (const document of getDirtyDocuments()) {
        flushPendingEditorChange(document.id)
      }
      const dirtyDocuments = getDirtyDocuments()
      const unsupportedDocument = dirtyDocuments.find(
        (document) => !canAutoSaveWorkingDocument(document)
      )
      if (unsupportedDocument) {
        detail.reject(
          `Unsaved changes in ${unsupportedDocument.target.relativePath} cannot be saved.`
        )
        return
      }
      await Promise.all(dirtyDocuments.map((document) => queueSave(document.id)))
      detail.resolve()
    } catch (error) {
      detail.reject(String((error as Error)?.message ?? error))
    }
  }

  const handlePrepareHotExit = async (event: Event): Promise<void> => {
    const detail = (event as CustomEvent<EditorPrepareHotExitDetail>).detail
    if (!detail) {
      return
    }
    try {
      detail.claim()
      const documents = Object.values(store.getState().workingDocuments)
      for (const document of documents) {
        flushPendingEditorChange(document.id)
      }
      await Promise.all(documents.map((document) => quiesceDocumentSave(document.id)))

      const dirtyDocuments = getDirtyDocuments()
      if (dirtyDocuments.some((document) => document.content === undefined)) {
        detail.reject('Unsaved editor changes are still loading and cannot be backed up.')
        return
      }
      if (dirtyDocuments.length > 0 && !shouldPersistWorkspaceSession(store.getState())) {
        detail.reject(
          'Unsaved editor changes cannot be backed up until workspace restore finishes.'
        )
        return
      }
      detail.resolve()
    } catch (error) {
      detail.reject(String((error as Error)?.message ?? error))
    }
  }

  return { handleSaveDirtyFiles, handlePrepareHotExit }
}
