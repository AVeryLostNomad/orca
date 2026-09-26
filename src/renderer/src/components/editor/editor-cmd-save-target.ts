import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import type { Tab, TabContentType } from '../../../../shared/tab-types'
import type { TopLevelView } from '../../../../shared/ui-chrome-types'

export const EDITOR_TAB_CONTENT_TYPES = new Set<TabContentType>([
  'editor',
  'diff',
  'conflict-review',
  'check-details'
])

type EditorCmdSaveState = {
  activeTabType: string | null
  activeView: TopLevelView
  activeWorktreeId: string | null
  getActiveTab: (worktreeId: string) => Tab | null
}

export function getEditorCmdSaveTabId(
  state: EditorCmdSaveState,
  floatingPanelOwnsEvent: boolean
): string | null {
  if (!floatingPanelOwnsEvent) {
    // Why: outside the workspace view no mounted panel claims the request, so
    // returning an id would swallow Cmd/Ctrl+S on Tasks/Settings without saving.
    // The floating panel floats above every view and keeps its own ownership.
    const activeTab =
      state.activeView === 'terminal' && state.activeTabType === 'editor' && state.activeWorktreeId
        ? state.getActiveTab(state.activeWorktreeId)
        : null
    return activeTab && EDITOR_TAB_CONTENT_TYPES.has(activeTab.contentType) ? activeTab.id : null
  }
  const activeTab = state.getActiveTab(FLOATING_TERMINAL_WORKTREE_ID)
  return activeTab && EDITOR_TAB_CONTENT_TYPES.has(activeTab.contentType) ? activeTab.id : null
}
