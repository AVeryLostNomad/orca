import type { WorkingDocument, WorkingDocumentId } from '@/store/slices/editor/working-document'
import { canAutoSaveWorkingDocument } from './editor-autosave'
import { trackExternalChangeConflictShown } from './editor-external-change-telemetry'

type ChangedOnDiskMarkState = {
  setWorkingDocumentExternalState: (
    documentId: WorkingDocumentId,
    patch: Pick<WorkingDocument, 'externalMutation'>
  ) => void
}

export function markWorkingDocumentChangedOnDisk(
  state: ChangedOnDiskMarkState,
  document: WorkingDocument,
  options: { origin: 'live' | 'restore' }
): void {
  if (!document.isDirty || !canAutoSaveWorkingDocument(document)) {
    return
  }
  if (document.externalMutation !== 'changed') {
    trackExternalChangeConflictShown(document, options)
  }
  state.setWorkingDocumentExternalState(document.id, { externalMutation: 'changed' })
}
