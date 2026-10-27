import type { ProjectGroup } from '../project-group-types'
import type { Repo } from '../repo-types'
import type { WorkspaceStatusDefinition, Worktree } from '../worktree/types'
import { getRepoExecutionHostId } from '../execution-host'
import { getProjectGroupHostIdentity } from '../project-groups'
import {
  cloneDefaultWorkspaceStatuses,
  getWorkspaceStatus,
  getWorkspaceStatusGroupKey
} from '../workspace-statuses'
import { ALL_GROUP_KEY, getPRLaneKey, getProjectGroupHeaderKey } from './group-keys'
import { buildProjectGroupingIndex, getProjectGroupingForRepo } from '../project-section-grouping'
import type { ProjectSectionModel } from '../project-section-grouping'
import type { SidebarPRGroupReader, WorktreeGroupBy } from './row-types'

export function getGroupKeyForWorktree(
  groupBy: WorktreeGroupBy,
  worktree: Worktree,
  repoMap: Map<string, Repo>,
  /** Null reads every worktree as having no PR, which is the in-progress lane. */
  prGroupOf: SidebarPRGroupReader | null,
  workspaceStatuses: readonly WorkspaceStatusDefinition[] = cloneDefaultWorkspaceStatuses(),
  projectGrouping?: ProjectSectionModel
): string | null {
  if (groupBy === 'none') {
    return ALL_GROUP_KEY
  }
  if (groupBy === 'workspace-status') {
    return getWorkspaceStatusGroupKey(getWorkspaceStatus(worktree, workspaceStatuses))
  }
  if (groupBy === 'repo') {
    return getProjectGroupingForRepo(
      worktree.repoId,
      repoMap,
      buildProjectGroupingIndex(projectGrouping)
    ).key
  }
  return getPRLaneKey(prGroupOf?.(worktree) ?? 'in-progress')
}

export function getGroupKeysForWorktree(
  groupBy: WorktreeGroupBy,
  worktree: Worktree,
  repoMap: Map<string, Repo>,
  prGroupOf: SidebarPRGroupReader | null,
  workspaceStatuses: readonly WorkspaceStatusDefinition[] = cloneDefaultWorkspaceStatuses(),
  projectGroups: readonly ProjectGroup[] = [],
  projectGrouping?: ProjectSectionModel
): string[] {
  const groupKey = getGroupKeyForWorktree(
    groupBy,
    worktree,
    repoMap,
    prGroupOf,
    workspaceStatuses,
    projectGrouping
  )
  if (!groupKey) {
    return []
  }
  if (groupBy !== 'repo') {
    return [groupKey]
  }
  const repo = repoMap.get(worktree.repoId)
  const groupsByIdentity = new Map(
    projectGroups.map((group) => [getProjectGroupHostIdentity(group), group])
  )
  const groupKeys: string[] = []
  const visited = new Set<string>()
  let currentGroupId = repo?.projectGroupId ?? null
  const hostId = repo ? getRepoExecutionHostId(repo) : undefined
  while (currentGroupId && hostId) {
    const identity = getProjectGroupHostIdentity({
      id: currentGroupId,
      connectionId: null,
      executionHostId: hostId
    })
    if (visited.has(identity)) {
      break
    }
    const group = groupsByIdentity.get(identity)
    if (!group) {
      // Remote repos may precede Project Group metadata; reveal keys must match planSidebarRows’ fallback rows.
      break
    }
    visited.add(identity)
    groupKeys.unshift(getProjectGroupHeaderKey(group))
    currentGroupId = group.parentGroupId
  }
  return [...groupKeys, groupKey]
}
