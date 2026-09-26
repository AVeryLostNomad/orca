import { useCallback } from 'react'
import { useAppStore } from '@/store'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'

// Canonical documents own dirty reconciliation. Surfaces only identify the
// document they edited; this prevents an older diff snapshot or sibling tab
// baseline from deciding whether the shared buffer is dirty.
export function useEditorContentChangeHandler(): (
  documentId: WorkingDocumentId | null,
  content: string
) => void {
  const setWorkingDocumentContent = useAppStore((state) => state.setWorkingDocumentContent)

  return useCallback(
    (documentId, content) => {
      if (documentId !== null) {
        setWorkingDocumentContent(documentId, content)
      }
    },
    [setWorkingDocumentContent]
  )
}
