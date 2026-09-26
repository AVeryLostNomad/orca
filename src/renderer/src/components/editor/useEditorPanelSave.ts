import { useCallback } from 'react'
import type { OpenFile } from '@/store/slices/editor'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import { attemptEditorDocumentSave } from './editor-file-save-attempt'

type UseEditorPanelSaveParams = {
  activeDocumentId: WorkingDocumentId | null
  activeFile: Pick<OpenFile, 'id' | 'isUntitled'> | null
  requestRenameForFile: (fileId: string) => void
}

// Content is intentionally absent from this API. A rich/Monaco surface may
// invoke Cmd/Ctrl+S with a stale render-time string; the queue flushes producers
// and saves the canonical document that exists at the moment it executes.
export function useEditorPanelSave({
  activeDocumentId,
  activeFile,
  requestRenameForFile
}: UseEditorPanelSaveParams) {
  const handleSaveForDocument = useCallback(
    async (documentId: WorkingDocumentId | null): Promise<boolean> => {
      if (!documentId) {
        return false
      }
      return attemptEditorDocumentSave({ documentId })
    },
    []
  )
  const handleSave = useCallback((): Promise<boolean> => {
    if (!activeDocumentId && activeFile?.isUntitled) {
      requestRenameForFile(activeFile.id)
      return Promise.resolve(false)
    }
    return handleSaveForDocument(activeDocumentId)
  }, [activeDocumentId, activeFile, handleSaveForDocument, requestRenameForFile])
  return { handleSave, handleSaveForDocument }
}
