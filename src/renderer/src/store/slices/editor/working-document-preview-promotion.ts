import type { AppState } from '../../types'
import type { Tab } from '../../../../../shared/tab-types'
import { endsPreviewHere } from '../tabs/preview-tab-promotion'
import type { WorkingDocumentId } from './working-document'

// Kept apart from working-document-state: session persistence imports that, and the layout-owner send path must not load with it.
/** Preview tabs showing `documentId` whose preview main owns; the window cannot end those itself. */
export function dirtyDocumentPreviewTabsOwnedByMain(
  state: AppState,
  documentId: WorkingDocumentId
): Tab[] {
  return Object.entries(state.unifiedTabsByWorktree ?? {}).flatMap(([worktreeId, tabs]) =>
    endsPreviewHere(state, worktreeId)
      ? []
      : tabs.filter(
          (tab) => tab.isPreview && state.workingDocumentIdsByTab[tab.id]?.includes(documentId)
        )
  )
}

export function promoteDirtyDocumentPreviewTabs(
  state: AppState,
  documentId: WorkingDocumentId
): AppState['unifiedTabsByWorktree'] {
  let unifiedTabsByWorktree: AppState['unifiedTabsByWorktree'] | undefined
  for (const [worktreeId, tabs] of Object.entries(state.unifiedTabsByWorktree ?? {})) {
    // Switch point: main's frame ends a preview main owns.
    if (
      !endsPreviewHere(state, worktreeId) ||
      !tabs.some(
        (tab) => tab.isPreview && state.workingDocumentIdsByTab[tab.id]?.includes(documentId)
      )
    ) {
      continue
    }
    unifiedTabsByWorktree ??= { ...state.unifiedTabsByWorktree }
    unifiedTabsByWorktree[worktreeId] = tabs.map((tab) =>
      tab.isPreview && state.workingDocumentIdsByTab[tab.id]?.includes(documentId)
        ? { ...tab, isPreview: false }
        : tab
    )
  }
  return unifiedTabsByWorktree ?? state.unifiedTabsByWorktree
}
