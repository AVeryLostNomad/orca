import type { Worktree } from '../../../../shared/worktree/types'
import type { AppState } from '@/store/types'
import { getSettingsFocusedExecutionHostId } from '../../../../shared/execution-host'
import { getRepoMapFromState, getWorktreeMapFromState } from '@/store/selectors'
import { getProjectHostSetupProjectionFromState } from '@/store/project-host-setup-selector'
import { planSidebarRows } from '../../../../shared/sidebar-list/sidebar-row-plan'
import { createSidebarPRGroupReader } from './worktree-list/grouping/pr-group-key'
import {
  getPinnedWorktreeDisplayPolicy,
  type ImportedWorktreesCardCandidate,
  type NewExternalWorktreesInboxCandidate,
  type PendingCreationRef,
  type Row
} from '../../../../shared/sidebar-list/row-types'
import { getLogicalRepoOrderRankById } from '../../../../shared/project-section-order'
import { getRenderedWorktreesInSidebarOrder } from './worktree-sidebar-row-preference'
import { selectWorktreeListReviewCacheInputs } from './worktree-list/listing/review-cache-inputs'
import {
  filterFolderWorkspacesForVisibleHosts,
  filterProjectGroupsForVisibleHosts
} from '../../../../shared/sidebar-list/host-filtering'
import { getSidebarHostPagesFromState } from './sidebar-host-pages'
import { selectFolderWorkspaces } from '@/store/workspace-record-selectors'
import { selectWorkspaceBoardStatuses } from '@/store/host-workspace-status-columns'

const EMPTY_REPO_ID_SET: ReadonlySet<string> = Object.freeze(new Set<string>())
const EMPTY_IMPORTED_BY_REPO: ReadonlyMap<string, ImportedWorktreesCardCandidate> = new Map()
const EMPTY_INBOX_BY_REPO: ReadonlyMap<string, NewExternalWorktreesInboxCandidate> = new Map()
const EMPTY_PENDING_CREATIONS: readonly PendingCreationRef[] = []

/** Replay grouping, pins and collapse for unmounted-list shortcut order without reversing the visible-worktrees dependency. */
export function computeRenderedSidebarWorktrees(
  state: AppState,
  visibleWorktrees: readonly Worktree[]
): Worktree[] {
  return getRenderedWorktreesInSidebarOrder(
    computeRenderedSidebarRows(state, visibleWorktrees),
    getPinnedWorktreeDisplayPolicy(state.settings)
  )
}

export function computeRenderedSidebarRows(
  state: AppState,
  visibleWorktrees: readonly Worktree[]
): Row[] {
  const defaultHostId = getSettingsFocusedExecutionHostId(state.settings)
  const pinnedDisplayPolicy = getPinnedWorktreeDisplayPolicy(state.settings)
  const projection = getProjectHostSetupProjectionFromState(state)
  // Why the page: the sidebar only ever renders one host's rows.
  const visibleHostIdSet = new Set([
    getSidebarHostPagesFromState(state, defaultHostId).activePage.id
  ])
  const projectGroups = state.projectGroups ?? []
  const { prCache } = selectWorktreeListReviewCacheInputs(
    state,
    state.groupBy,
    state.worktreeCardProperties
  )

  const repoMap = getRepoMapFromState(state)
  const rows = planSidebarRows({
    groupBy: state.groupBy,
    worktrees: [...visibleWorktrees],
    repoMap,
    prGroupOf: createSidebarPRGroupReader(repoMap, prCache),
    repoOrder: getLogicalRepoOrderRankById(state.repos.map((repo) => repo.id)),
    workspaceStatuses: selectWorkspaceBoardStatuses(state),
    projectOrderBy: state.projectOrderBy,
    lineageById: state.worktreeLineageById,
    worktreeMap: getWorktreeMapFromState(state),
    nestLineage: true,
    projectGroups: filterProjectGroupsForVisibleHosts(
      projectGroups,
      visibleHostIdSet,
      defaultHostId
    ),
    // Why empty: placeholder/imported/inbox/pending inputs never emit item or folder-workspace rows, the only two the order reads.
    placeholderRepoIds: EMPTY_REPO_ID_SET,
    importedWorktreesByRepo: EMPTY_IMPORTED_BY_REPO,
    newExternalWorktreesInboxByRepo: EMPTY_INBOX_BY_REPO,
    pendingCreations: EMPTY_PENDING_CREATIONS,
    projectGrouping: { projects: projection.projects, projectHostSetups: projection.setups },
    folderWorkspaces: filterFolderWorkspacesForVisibleHosts(
      selectFolderWorkspaces(state),
      projectGroups,
      visibleHostIdSet,
      defaultHostId
    ),
    includeGroupWideWorkspaces: true,
    // Why no hostLabelById: it only feeds display-only host context labels, never row order.
    defaultHostId,
    pinnedDisplayPolicy,
    filterRepoIds: state.filterRepoIds
  }).render(state.collapsedGroups)
  return rows
}

export function computeRenderedSidebarWorktreeOrder(
  state: AppState,
  visibleWorktrees: readonly Worktree[]
): string[] {
  return Array.from(
    new Set(computeRenderedSidebarWorktrees(state, visibleWorktrees).map((worktree) => worktree.id))
  )
}
