import {
  ALL_EXECUTION_HOSTS_SCOPE,
  getWorktreeExecutionHostId,
  normalizeExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId,
  type ExecutionHostScope
} from '../execution-host'
import { getProjectGroupExecutionHostId } from '../project-groups'
import type { FolderWorkspace } from '../folder-workspace-types'
import type { ProjectGroup } from '../project-group-types'
import type { Repo } from '../repo-types'

/** null means "no host filter" — every host is visible. */
export function getVisibleSidebarHostIdSet(
  visibleWorkspaceHostIds: readonly ExecutionHostId[] | null | undefined,
  workspaceHostScope: ExecutionHostScope
): Set<ExecutionHostId> | null {
  const visibleHostIds =
    visibleWorkspaceHostIds ??
    (workspaceHostScope === ALL_EXECUTION_HOSTS_SCOPE ? null : [workspaceHostScope])
  return visibleHostIds ? new Set<ExecutionHostId>(visibleHostIds) : null
}

// Use identical host filtering for visible cards and Cmd+1–9 numbering.
export function filterProjectGroupsForVisibleHosts(
  projectGroups: readonly ProjectGroup[],
  visibleHostIdSet: ReadonlySet<ExecutionHostId> | null,
  defaultHostId: ExecutionHostId
): readonly ProjectGroup[] {
  if (!visibleHostIdSet) {
    return projectGroups
  }
  return projectGroups.filter((group) =>
    visibleHostIdSet.has(getProjectGroupExecutionHostIdForRows(group, defaultHostId))
  )
}

export function filterReposForVisibleHosts(
  repos: readonly Repo[],
  visibleHostIdSet: ReadonlySet<ExecutionHostId> | null,
  defaultHostId: ExecutionHostId
): readonly Repo[] {
  return visibleHostIdSet
    ? repos.filter((repo) =>
        visibleHostIdSet.has(getWorktreeExecutionHostId({}, repo, defaultHostId))
      )
    : repos
}

export function filterFolderWorkspacesForVisibleHosts(
  folderWorkspaces: readonly FolderWorkspace[],
  projectGroups: readonly ProjectGroup[],
  visibleHostIdSet: ReadonlySet<ExecutionHostId> | null,
  defaultHostId: ExecutionHostId
): readonly FolderWorkspace[] {
  if (!visibleHostIdSet) {
    return folderWorkspaces
  }
  const resolveHostId = createFolderWorkspaceRowHostIdResolver(projectGroups, defaultHostId)
  return folderWorkspaces.filter((folderWorkspace) =>
    visibleHostIdSet.has(resolveHostId(folderWorkspace))
  )
}

/** Host a folder workspace row renders under, matching its project group by id and host. */
export function createFolderWorkspaceRowHostIdResolver(
  projectGroups: readonly ProjectGroup[],
  defaultHostId: ExecutionHostId
): (folderWorkspace: FolderWorkspace) => ExecutionHostId {
  const projectGroupsById = new Map<string, ProjectGroup[]>()
  for (const group of projectGroups) {
    const groups = projectGroupsById.get(group.id) ?? []
    groups.push(group)
    projectGroupsById.set(group.id, groups)
  }
  return (folderWorkspace) => {
    const folderHostId =
      normalizeExecutionHostId(folderWorkspace.executionHostId) ??
      (folderWorkspace.connectionId
        ? toSshExecutionHostId(folderWorkspace.connectionId)
        : defaultHostId)
    const candidates = projectGroupsById.get(folderWorkspace.projectGroupId)
    const projectGroup =
      candidates?.find(
        (group) => getProjectGroupExecutionHostIdForRows(group, defaultHostId) === folderHostId
      ) ??
      candidates?.find(
        (group) => getProjectGroupExecutionHostIdForRows(group, defaultHostId) === defaultHostId
      ) ??
      candidates?.[0]
    return getFolderWorkspaceExecutionHostIdForRows({
      folderWorkspace,
      projectGroup,
      defaultHostId
    })
  }
}

export function getProjectGroupExecutionHostIdForRows(
  group: Pick<ProjectGroup, 'connectionId' | 'executionHostId'>,
  defaultHostId: ExecutionHostId
): ExecutionHostId {
  return getProjectGroupExecutionHostId(group, defaultHostId)
}

export function getFolderWorkspaceExecutionHostIdForRows({
  folderWorkspace,
  projectGroup,
  defaultHostId
}: {
  folderWorkspace: Pick<FolderWorkspace, 'connectionId' | 'executionHostId'>
  projectGroup: Pick<ProjectGroup, 'connectionId' | 'executionHostId'> | undefined
  defaultHostId: ExecutionHostId
}): ExecutionHostId {
  const explicitFolderHostId = normalizeExecutionHostId(folderWorkspace.executionHostId)
  if (explicitFolderHostId) {
    return explicitFolderHostId
  }
  if (projectGroup) {
    const explicitProjectGroupHostId = normalizeExecutionHostId(projectGroup.executionHostId)
    if (explicitProjectGroupHostId) {
      return explicitProjectGroupHostId
    }
    const projectGroupHostId = getProjectGroupExecutionHostIdForRows(projectGroup, defaultHostId)
    if (projectGroupHostId !== defaultHostId || !folderWorkspace.connectionId) {
      return projectGroupHostId
    }
  }
  return folderWorkspace.connectionId
    ? toSshExecutionHostId(folderWorkspace.connectionId)
    : defaultHostId
}
