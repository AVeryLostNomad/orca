import type { AppState } from '@/store'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import { getRecentSelfWrite } from './editor-self-write-registry'
import {
  getEditorExternalFileChangeGeneration,
  type EditorPathMutationTarget
} from './editor-autosave'
import { loadWorkingDocument } from './working-document-loader'
import type { AppStoreApi, EditorSaveQueue } from './editor-save-queue'

type EditorExternalChangeDocumentResetOptions = {
  store: AppStoreApi
  clearAutoSaveTimer: EditorSaveQueue['clearAutoSaveTimer']
  bumpSaveGeneration: EditorSaveQueue['bumpSaveGeneration']
}

function matchingDocumentIds(
  state: AppState,
  target: EditorPathMutationTarget
): WorkingDocumentId[] {
  const runtimeEnvironmentId = target.runtimeEnvironmentId?.trim() || null
  return Object.values(state.workingDocuments)
    .filter(
      (document) =>
        document.target.worktreeId === target.worktreeId &&
        document.target.relativePath === target.relativePath &&
        document.target.owner.runtimeEnvironmentId === runtimeEnvironmentId
    )
    .map((document) => document.id)
}

export function createEditorExternalChangeDocumentReset({
  store,
  clearAutoSaveTimer,
  bumpSaveGeneration
}: EditorExternalChangeDocumentResetOptions): (event: Event) => void {
  return (event: Event): void => {
    const target = (event as CustomEvent<EditorPathMutationTarget>).detail
    if (!target) {
      return
    }
    const state = store.getState()
    const externalEventGeneration = getEditorExternalFileChangeGeneration(event)
    for (const documentId of matchingDocumentIds(state, target)) {
      const document = state.workingDocuments[documentId]
      if (!document) {
        continue
      }
      if (document.isDirty) {
        if (!getRecentSelfWrite(documentId)) {
          state.setWorkingDocumentExternalState(documentId, { externalMutation: 'changed' })
        }
        continue
      }
      clearAutoSaveTimer(documentId)
      bumpSaveGeneration(documentId)
      if (document.externalMutation === 'changed') {
        state.setWorkingDocumentExternalState(documentId, { externalMutation: undefined })
      }
      // Why: the retained buffer outlives unmounted panels; without this a later mount serves the pre-change cache.
      if (document.loadState === 'ready' || document.loadState === 'loading') {
        // Load failures are recorded on the document itself.
        void loadWorkingDocument(documentId, { force: true, externalEventGeneration }).catch(
          () => {}
        )
      }
    }
  }
}
