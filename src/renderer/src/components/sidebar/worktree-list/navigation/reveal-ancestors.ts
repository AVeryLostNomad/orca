import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'
import {
  getRepoExecutionHostId,
  type ExecutionHostId
} from '../../../../../../shared/execution-host'
import {
  getProjectGroupExecutionHostId,
  getProjectGroupHostIdentity
} from '../../../../../../shared/project-groups'
import { getProjectGroupHeaderKey } from '../../../../../../shared/sidebar-list/group-keys'
import type { ProjectGroupingModel } from '../../../../../../shared/project-section-grouping'

function getProjectIdFromHeaderRowKey(rowKey: string): string | null {
  if (!rowKey.startsWith('project:')) {
    return null
  }
  return rowKey.slice('project:'.length)
}

function getRepoIdsFromHeaderRowKey(
  rowKey: string,
  repoMap: Map<string, Repo>,
  projectGrouping?: ProjectGroupingModel
): string[] {
  if (rowKey.startsWith('repo:')) {
    return [rowKey.slice('repo:'.length)]
  }
  const projectId = getProjectIdFromHeaderRowKey(rowKey)
  if (!projectId) {
    return []
  }
  const repoIds = new Set<string>()
  for (const setup of projectGrouping?.projectHostSetups ?? []) {
    if (setup.projectId === projectId && repoMap.has(setup.repoId)) {
      repoIds.add(setup.repoId)
    }
  }
  const project = projectGrouping?.projects.find((candidate) => candidate.id === projectId)
  for (const repoId of project?.sourceRepoIds ?? []) {
    if (repoMap.has(repoId)) {
      repoIds.add(repoId)
    }
  }
  return [...repoIds]
}

function getProjectGroupAncestorKeys(
  projectGroupId: string | null | undefined,
  hostId: ExecutionHostId | undefined,
  projectGroups: readonly ProjectGroup[]
): string[] {
  if (!projectGroupId || !hostId) {
    return []
  }
  const groupsByIdentity = new Map(
    projectGroups.map((group) => [getProjectGroupHostIdentity(group), group])
  )
  const keys: string[] = []
  const seen = new Set<string>()
  let groupId: string | null = projectGroupId
  while (groupId) {
    const group = groupsByIdentity.get(
      getProjectGroupHostIdentity({
        id: groupId,
        connectionId: null,
        executionHostId: hostId
      })
    )
    if (!group) {
      break
    }
    const identity = getProjectGroupHostIdentity(group)
    if (seen.has(identity)) {
      break
    }
    seen.add(identity)
    keys.unshift(getProjectGroupHeaderKey(group))
    groupId = group.parentGroupId
  }
  return keys
}

export function getSidebarRowRevealAncestorKeys(args: {
  rowKey: string
  repoMap: Map<string, Repo>
  projectGroups: readonly ProjectGroup[]
  projectGrouping?: ProjectGroupingModel
}): string[] {
  if (args.rowKey.startsWith('project-group:')) {
    const group = args.projectGroups.find(
      (candidate) => getProjectGroupHeaderKey(candidate) === args.rowKey
    )
    return getProjectGroupAncestorKeys(
      group?.parentGroupId,
      group ? getProjectGroupExecutionHostId(group) : undefined,
      args.projectGroups
    )
  }
  const keys = new Set<string>()
  for (const repoId of getRepoIdsFromHeaderRowKey(
    args.rowKey,
    args.repoMap,
    args.projectGrouping
  )) {
    const repo = args.repoMap.get(repoId)
    for (const key of getProjectGroupAncestorKeys(
      repo?.projectGroupId,
      repo ? getRepoExecutionHostId(repo) : undefined,
      args.projectGroups
    )) {
      keys.add(key)
    }
  }
  return [...keys]
}
