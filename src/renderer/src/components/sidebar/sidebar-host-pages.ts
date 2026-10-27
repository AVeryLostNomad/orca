import type { AppState } from '@/store/types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import {
  LOCAL_EXECUTION_HOST_ID,
  getExecutionHostLabel,
  getRepoExecutionHostId,
  getWorktreeExecutionHostId,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { getHostDisplayLabelOverrides } from '../../../../shared/host-setting-overrides'
import { buildSidebarHostOptions, type SidebarHostOption } from './sidebar-host-options'
import { orderHostSectionOptions } from '../../../../shared/sidebar-list/host-section-order'
import {
  createFolderWorkspaceRowHostIdResolver,
  getProjectGroupExecutionHostIdForRows,
  getVisibleSidebarHostIdSet
} from '../../../../shared/sidebar-list/host-filtering'
import { selectFolderWorkspaces, selectWorktreesByRepo } from '@/store/workspace-record-selectors'

/** One horizontally paged sidebar: every row on it belongs to this execution host. */
export type SidebarHostPage = SidebarHostOption

export type SidebarHostContent = Pick<AppState, 'folderWorkspaces' | 'worktreesByRepo'> & {
  repos: readonly Repo[]
  projectGroups: readonly ProjectGroup[]
  defaultHostId: ExecutionHostId
}

/** Hosts owning at least one sidebar row, resolved exactly as the row pipeline assigns hosts. */
export function collectSidebarContentHostIds(content: SidebarHostContent): Set<ExecutionHostId> {
  const hostIds = new Set<ExecutionHostId>()
  const repoById = new Map<string, Repo>()
  for (const repo of content.repos) {
    repoById.set(repo.id, repo)
    hostIds.add(
      repo.connectionId || repo.executionHostId
        ? getRepoExecutionHostId(repo)
        : content.defaultHostId
    )
  }
  for (const group of content.projectGroups) {
    hostIds.add(getProjectGroupExecutionHostIdForRows(group, content.defaultHostId))
  }
  const resolveFolderHostId = createFolderWorkspaceRowHostIdResolver(
    content.projectGroups,
    content.defaultHostId
  )
  for (const folderWorkspace of selectFolderWorkspaces(content)) {
    hostIds.add(resolveFolderHostId(folderWorkspace))
  }
  for (const [repoId, worktrees] of Object.entries(selectWorktreesByRepo(content))) {
    const repo = repoById.get(repoId)
    // Why: rows drop worktrees whose repo is unknown, so they never earn a page.
    if (!repo) {
      continue
    }
    for (const worktree of worktrees) {
      if (!worktree.isArchived) {
        hostIds.add(getWorktreeExecutionHostId(worktree, repo, content.defaultHostId))
      }
    }
  }
  return hostIds
}

function fallbackHostPage(hostId: ExecutionHostId): SidebarHostPage {
  const kind = parseExecutionHostId(hostId)?.kind ?? 'local'
  return {
    id: hostId,
    kind,
    label: getExecutionHostLabel(hostId),
    detail: '',
    health: kind === 'local' ? 'local' : 'available',
    presence: kind === 'local' ? 'local' : 'project'
  }
}

/**
 * Local first, then each other host that owns sidebar content, in the user's
 * host order. The Hosts filter decides which pages exist at all.
 */
export function buildSidebarHostPages(args: {
  hostOptions: readonly SidebarHostOption[]
  workspaceHostOrder: readonly ExecutionHostId[]
  contentHostIds: ReadonlySet<ExecutionHostId>
  visibleHostIdSet: ReadonlySet<ExecutionHostId> | null
}): SidebarHostPage[] {
  const { contentHostIds, visibleHostIdSet } = args
  const orderedHosts = orderHostSectionOptions(args.hostOptions, args.workspaceHostOrder)
  const pages: SidebarHostPage[] = []
  const pagedHostIds = new Set<ExecutionHostId>()
  const addPage = (page: SidebarHostPage): void => {
    pages.push(page)
    pagedHostIds.add(page.id)
  }
  if (!visibleHostIdSet || visibleHostIdSet.has(LOCAL_EXECUTION_HOST_ID)) {
    addPage(
      orderedHosts.find((host) => host.id === LOCAL_EXECUTION_HOST_ID) ??
        fallbackHostPage(LOCAL_EXECUTION_HOST_ID)
    )
  }
  for (const host of orderedHosts) {
    if (
      !pagedHostIds.has(host.id) &&
      contentHostIds.has(host.id) &&
      (!visibleHostIdSet || visibleHostIdSet.has(host.id))
    ) {
      addPage(host)
    }
  }
  // Why: rows can reference a host the registry has not surfaced yet; it still needs a page.
  for (const hostId of contentHostIds) {
    if (!pagedHostIds.has(hostId) && (!visibleHostIdSet || visibleHostIdSet.has(hostId))) {
      addPage(fallbackHostPage(hostId))
    }
  }
  if (pages.length === 0) {
    // Why: a Hosts filter naming only empty hosts still needs a page to show its empty state.
    const firstVisibleHost = orderedHosts.find((host) => visibleHostIdSet?.has(host.id))
    addPage(firstVisibleHost ?? fallbackHostPage(LOCAL_EXECUTION_HOST_ID))
  }
  return pages
}

export function resolveActiveSidebarHostPage(
  pages: readonly SidebarHostPage[],
  requestedHostId: ExecutionHostId | null | undefined
): SidebarHostPage {
  return (
    pages.find((page) => page.id === requestedHostId) ??
    pages[0] ??
    fallbackHostPage(LOCAL_EXECUTION_HOST_ID)
  )
}

/**
 * Store-snapshot form of the pager's page list, for callers outside React. `defaultHostId` is the
 * row pipeline's host for rows that record none.
 */
export function getSidebarHostPagesFromState(
  state: Pick<
    AppState,
    | 'repos'
    | 'projectGroups'
    | 'folderWorkspaces'
    | 'worktreesByRepo'
    | 'settings'
    | 'sshTargetLabels'
    | 'sshConnectionStates'
    | 'runtimeEnvironments'
    | 'runtimeStatusByEnvironmentId'
    | 'workspaceHostOrder'
    | 'visibleWorkspaceHostIds'
    | 'workspaceHostScope'
    | 'sidebarHostPageId'
    | 'wslHostStatuses'
    | 'wslHostServerFiles'
  >,
  defaultHostId: ExecutionHostId
): { pages: SidebarHostPage[]; activePage: SidebarHostPage } {
  const repos = state.repos ?? []
  const pages = buildSidebarHostPages({
    hostOptions: buildSidebarHostOptions({
      repos,
      sshTargetLabels: state.sshTargetLabels ?? new Map(),
      sshConnectionStates: state.sshConnectionStates,
      settings: state.settings,
      runtimeEnvironments: state.runtimeEnvironments,
      runtimeStatusByEnvironmentId: state.runtimeStatusByEnvironmentId,
      hostLabelOverrides: getHostDisplayLabelOverrides(state.settings),
      wslHostStatuses: state.wslHostStatuses,
      wslHostsEnabled: state.settings?.experimentalWslHosts === true,
      wslHostServerFilesMissing: state.wslHostServerFiles === 'missing'
    }),
    workspaceHostOrder: state.workspaceHostOrder ?? [],
    contentHostIds: collectSidebarContentHostIds({
      repos,
      projectGroups: state.projectGroups ?? [],
      folderWorkspaces: selectFolderWorkspaces(state) ?? [],
      worktreesByRepo: selectWorktreesByRepo(state) ?? {},
      defaultHostId
    }),
    visibleHostIdSet: getVisibleSidebarHostIdSet(
      state.visibleWorkspaceHostIds,
      state.workspaceHostScope
    )
  })
  return { pages, activePage: resolveActiveSidebarHostPage(pages, state.sidebarHostPageId) }
}
