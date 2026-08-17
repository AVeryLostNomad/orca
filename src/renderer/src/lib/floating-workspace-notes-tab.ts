import {
  FLOATING_TERMINAL_WORKTREE_ID,
  FLOATING_WORKSPACE_NOTES_TAB_ID
} from '../../../shared/constants'
import type { Tab } from '../../../shared/tab-types'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import type { AppState } from '@/store/types'

/** Permanent tabs have no close/unpin affordance anywhere and survive every bulk close. */
export function isPermanentFloatingTab(tab: Pick<Tab, 'contentType'>): boolean {
  return tab.contentType === 'workspace-notes'
}

type FloatingWorkspaceNotesStore = Pick<
  AppState,
  'unifiedTabsByWorktree' | 'activeGroupIdByWorktree' | 'createUnifiedTab'
>

/** Idempotently (re)creates the permanent notes tab — hydration may have salvage-dropped it. */
export function ensureFloatingWorkspaceNotesTab(store: FloatingWorkspaceNotesStore): Tab {
  const existing = (store.unifiedTabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID] ?? []).find(
    (tab) => tab.id === FLOATING_WORKSPACE_NOTES_TAB_ID
  )
  if (existing) {
    return existing
  }
  const targetGroupId = store.activeGroupIdByWorktree[FLOATING_TERMINAL_WORKTREE_ID]
  return store.createUnifiedTab(FLOATING_TERMINAL_WORKTREE_ID, 'workspace-notes', {
    id: FLOATING_WORKSPACE_NOTES_TAB_ID,
    entityId: FLOATING_WORKSPACE_NOTES_TAB_ID,
    label: 'Notes',
    isPinned: true,
    activate: false,
    recordInteraction: false,
    ...(targetGroupId ? { targetGroupId } : {})
  })
}

/** Worktree ids are `repoId::path`; the header must never bake that raw form — use the last path segment. */
function workspaceNameFromId(workspaceId: string): string {
  const separatorIndex = workspaceId.lastIndexOf('::')
  const pathPart = separatorIndex === -1 ? workspaceId : workspaceId.slice(separatorIndex + 2)
  const segments = pathPart.split(/[\\/]/).filter(Boolean)
  return segments.at(-1) ?? workspaceId
}

/** Workspace name for the notes template header; workspaceId may be a worktree id or folder key. */
export function resolveWorkspaceDisplayName(
  state: Pick<AppState, 'worktreesByRepo' | 'folderWorkspaces'>,
  workspaceId: string
): string {
  const worktreeName = findWorktreeById(state.worktreesByRepo, workspaceId)?.displayName?.trim()
  if (worktreeName) {
    return worktreeName
  }
  const scope = parseWorkspaceKey(workspaceId)
  if (scope?.type === 'folder') {
    const folderName = state.folderWorkspaces
      .find((workspace) => workspace.id === scope.folderWorkspaceId)
      ?.name?.trim()
    if (folderName) {
      return folderName
    }
    return workspaceNameFromId(scope.folderWorkspaceId)
  }
  return workspaceNameFromId(workspaceId)
}
