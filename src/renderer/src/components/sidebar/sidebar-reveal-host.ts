import type { AppState } from '@/store/types'
import type {
  PendingSidebarRowReveal,
  PendingSidebarWorktreeReveal
} from '@/store/slices/ui/ui-slice-contract-core'
import {
  getProjectHostSetupProjectionFromState,
  type ProjectCatalogReadState
} from '@/store/project-host-setup-selector'
import { getRepoMapFromState } from '@/store/selectors'
import {
  getRepoExecutionHostId,
  getWorktreeExecutionHostId,
  normalizeExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { getProjectGroupHeaderKey } from '../../../../shared/sidebar-list/group-keys'
import {
  createFolderWorkspaceRowHostIdResolver,
  getProjectGroupExecutionHostIdForRows
} from '../../../../shared/sidebar-list/host-filtering'
import { selectFolderWorkspaces, selectWorktreesByRepo } from '@/store/workspace-record-selectors'
import type { SidebarHostPage } from './sidebar-host-pages'

type RevealHostState = ProjectCatalogReadState &
  Pick<AppState, 'repos' | 'projectGroups' | 'folderWorkspaces' | 'worktreesByRepo'>

function getFolderWorkspaceRevealHostIds(
  state: RevealHostState,
  folderWorkspaceId: string,
  defaultHostId: ExecutionHostId
): ExecutionHostId[] {
  const projectGroups = state.projectGroups ?? []
  const resolveHostId = createFolderWorkspaceRowHostIdResolver(projectGroups, defaultHostId)
  return (selectFolderWorkspaces(state) ?? [])
    .filter((folderWorkspace) => folderWorkspace.id === folderWorkspaceId)
    .map(resolveHostId)
}

function getRowRevealHostIds(
  state: RevealHostState,
  rowKey: string,
  defaultHostId: ExecutionHostId
): ExecutionHostId[] {
  const folderScope = parseWorkspaceKey(rowKey)
  if (folderScope?.type === 'folder') {
    return getFolderWorkspaceRevealHostIds(state, folderScope.folderWorkspaceId, defaultHostId)
  }
  const repoHostId = (repo: AppState['repos'][number]): ExecutionHostId =>
    repo.connectionId || repo.executionHostId ? getRepoExecutionHostId(repo) : defaultHostId
  if (rowKey.startsWith('repo:')) {
    const repoId = rowKey.slice('repo:'.length)
    return state.repos.filter((repo) => repo.id === repoId).map(repoHostId)
  }
  if (rowKey.startsWith('project-group:')) {
    return (state.projectGroups ?? [])
      .filter((group) => getProjectGroupHeaderKey(group) === rowKey)
      .map((group) => getProjectGroupExecutionHostIdForRows(group, defaultHostId))
  }
  if (rowKey.startsWith('project:')) {
    const [projectId, setupRepoId] = rowKey.slice('project:'.length).split('::setup:')
    return getProjectHostSetupProjectionFromState(state)
      .setups.filter((setup) =>
        setupRepoId ? setup.repoId === setupRepoId : setup.projectId === projectId
      )
      .map((setup) => setup.hostId)
  }
  return []
}

/**
 * Hosts whose sidebar page renders a reveal target; empty when the target names no host.
 * `defaultHostId` is the row pipeline's host for rows that record none.
 */
export function getSidebarRevealTargetHostIds(
  state: RevealHostState,
  reveal: PendingSidebarWorktreeReveal | PendingSidebarRowReveal,
  defaultHostId: ExecutionHostId
): ExecutionHostId[] {
  if ('rowKey' in reveal) {
    return getRowRevealHostIds(state, reveal.rowKey, defaultHostId)
  }
  const explicitHostId = normalizeExecutionHostId(reveal.executionHostId)
  if (explicitHostId) {
    return [explicitHostId]
  }
  const folderScope = parseWorkspaceKey(reveal.worktreeId)
  if (folderScope?.type === 'folder') {
    return getFolderWorkspaceRevealHostIds(state, folderScope.folderWorkspaceId, defaultHostId)
  }
  const repoMap = getRepoMapFromState(state)
  return Object.values(selectWorktreesByRepo(state) ?? {})
    .flat()
    .filter((worktree) => worktree.id === reveal.worktreeId)
    .map((worktree) =>
      getWorktreeExecutionHostId(worktree, repoMap.get(worktree.repoId), defaultHostId)
    )
}

/**
 * The page that must consume a pending reveal: the active page when it can show the target
 * (or the target names no host), else the first page on a target host.
 */
export function resolveSidebarRevealPageId(
  pages: readonly SidebarHostPage[],
  activePageId: ExecutionHostId,
  targetHostIds: readonly ExecutionHostId[]
): ExecutionHostId {
  if (targetHostIds.length === 0 || targetHostIds.includes(activePageId)) {
    return activePageId
  }
  // Why fall back to the active page: with no page for the target, it clears the stale reveal.
  return pages.find((page) => targetHostIds.includes(page.id))?.id ?? activePageId
}
