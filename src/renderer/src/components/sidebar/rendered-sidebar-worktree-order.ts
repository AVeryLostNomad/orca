import type { Worktree } from '../../../../shared/worktree/types'
import type { AppState } from '@/store/types'
import { getSettingsFocusedExecutionHostId } from '../../../../shared/execution-host'
import { getRepoMapFromState, getWorktreeMapFromState } from '@/store/selectors'
import { getProjectHostSetupProjectionFromState } from '@/store/project-host-setup-selector'
import { buildRows } from './worktree-list/grouping/build-rows'
import { getPinnedWorktreeDisplayPolicy } from './worktree-list/grouping/row-types'
import { getLogicalRepoOrderRankById } from './project-header-drop'
import { getRenderedWorktreesInSidebarOrder } from './worktree-sidebar-row-preference'
import { selectWorktreeListReviewCacheInputs } from './worktree-list/listing/review-cache-inputs'
import {
  filterFolderWorkspacesForVisibleHosts,
  filterProjectGroupsForVisibleHosts
} from './worktree-list/listing/host-filtering'
import { getSidebarHostPagesFromState } from './sidebar-host-pages'

const EMPTY_REPO_ID_SET: ReadonlySet<string> = Object.freeze(new Set<string>())
const EMPTY_IMPORTED_BY_REPO = Object.freeze(new Map()) as never
const EMPTY_INBOX_BY_REPO = Object.freeze(new Map()) as never
const EMPTY_PENDING_CREATIONS = Object.freeze([]) as never

/**
 * Orders already-filtered worktrees the way the sidebar would render them, for
 * Cmd+1–9 numbering while WorktreeList is unmounted (#9497).
 *
 * Why replay the pipeline: a flat list drops grouping, pinning, main-worktree
 * hoisting and collapse elision, so the shortcut numbered the wrong card.
 * Why worktrees are passed in: keeps the dependency on visible-worktrees.ts
 * one-way, since test suites mock that module's path.
 */
export function computeRenderedSidebarWorktrees(
  state: AppState,
  visibleWorktrees: readonly Worktree[]
): Worktree[] {
  const defaultHostId = getSettingsFocusedExecutionHostId(state.settings)
  const pinnedDisplayPolicy = getPinnedWorktreeDisplayPolicy(state.settings)
  const projection = getProjectHostSetupProjectionFromState(state)
  // Why the page: the sidebar only ever renders one host's rows.
  const visibleHostIdSet = new Set([getSidebarHostPagesFromState(state).activePage.id])
  const projectGroups = state.projectGroups ?? []
  const { prCache } = selectWorktreeListReviewCacheInputs(
    state,
    state.groupBy,
    state.worktreeCardProperties
  )

  const rows = buildRows(
    state.groupBy,
    [...visibleWorktrees],
    getRepoMapFromState(state),
    prCache,
    state.collapsedGroups,
    getLogicalRepoOrderRankById(state.repos.map((repo) => repo.id)),
    state.workspaceStatuses,
    state.projectOrderBy,
    state.worktreeLineageById,
    getWorktreeMapFromState(state),
    true,
    state.settings,
    filterProjectGroupsForVisibleHosts(projectGroups, visibleHostIdSet, defaultHostId),
    // Why empty: placeholder/imported/inbox/pending inputs never emit item or folder-workspace rows, the only two the order reads.
    EMPTY_REPO_ID_SET,
    EMPTY_IMPORTED_BY_REPO,
    EMPTY_INBOX_BY_REPO,
    EMPTY_PENDING_CREATIONS,
    { projects: projection.projects, projectHostSetups: projection.setups },
    filterFolderWorkspacesForVisibleHosts(
      state.folderWorkspaces,
      projectGroups,
      visibleHostIdSet,
      defaultHostId
    ),
    pinnedDisplayPolicy
  )

  return getRenderedWorktreesInSidebarOrder(rows, pinnedDisplayPolicy)
}

export function computeRenderedSidebarWorktreeOrder(
  state: AppState,
  visibleWorktrees: readonly Worktree[]
): string[] {
  return Array.from(
    new Set(computeRenderedSidebarWorktrees(state, visibleWorktrees).map((worktree) => worktree.id))
  )
}
