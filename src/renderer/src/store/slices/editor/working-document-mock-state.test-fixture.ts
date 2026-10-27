import type { AppState } from '../../types'
import type { OpenFile } from './types/open-file'
import type { WorkingDocument, WorkingDocumentId } from './working-document'

type WorkingDocumentMockState = Pick<
  AppState,
  'workingDocuments' | 'workingDocumentIdsByTab' | 'unifiedTabsByWorktree'
>

/** Working-document fields for a plain mocked store: each dirty open file owns one unsaved document. */
export function mockWorkingDocumentState(
  files: readonly Pick<OpenFile, 'id' | 'isDirty'>[]
): WorkingDocumentMockState {
  const workingDocuments: Record<WorkingDocumentId, WorkingDocument> = {}
  const workingDocumentIdsByTab: Record<string, WorkingDocumentId[]> = {}
  for (const file of files) {
    if (!file.isDirty) {
      continue
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test ids only need to be unique strings.
    const id = `doc:${file.id}` as WorkingDocumentId
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: unsaved-file checks read only these fields.
    workingDocuments[id] = {
      id,
      content: 'unsaved',
      revision: 1,
      isDirty: true,
      loadState: 'ready',
      writable: true,
      alwaysAutoSave: false
    } as WorkingDocument
    workingDocumentIdsByTab[file.id] = [id]
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: plain records stand in for the store maps.
  return {
    workingDocuments,
    workingDocumentIdsByTab,
    unifiedTabsByWorktree: {}
  } as unknown as WorkingDocumentMockState
}
