import { useAppStore } from '@/store'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import { flushPendingEditorChangeAt } from './editor-pending-flush-registry'

export { registerPendingEditorFlush } from './editor-pending-flush-registry'

export function flushPendingEditorChange(
  documentId: WorkingDocumentId,
  exceptSurfaceId?: string,
  options?: { autosave?: boolean }
): void {
  flushPendingEditorChangeAt(
    documentId,
    () => useAppStore.getState().workingDocuments[documentId]?.revision,
    exceptSurfaceId,
    options?.autosave === true
  )
}
