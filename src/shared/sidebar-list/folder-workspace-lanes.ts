import type { FolderWorkspace } from '../folder-workspace-types'
import type { ProjectGroup } from '../project-group-types'
import type { Repo } from '../repo-types'
import { normalizeExecutionHostId, toSshExecutionHostId } from '../execution-host'
import { getProjectGroupExecutionHostId } from '../project-groups'
import { projectGroupToFolderWorkspace } from '../project-group-workspace'
import type { WorkspaceStatusDefinition } from '../worktree/types'
import { getWorkspaceStatus, getWorkspaceStatusGroupKey } from '../workspace-statuses'
import { ALL_GROUP_KEY, getPRLaneKey } from './group-keys'
import { compareCodePoints, compareSidebarText } from './text-order'
import type { WorktreeGroupBy } from './row-types'

/** Carry the owning ProjectGroup through emission: FolderWorkspaceRow requires it and emitters cannot resolve owners. */
export type RenderableFolderWorkspace = {
  folderWorkspace: FolderWorkspace
  projectGroup: ProjectGroup
  /** Ephemeral group root derived from its parent path or common project ancestor. */
  isGroupWide?: boolean
}

/** Resolve membership before grouping so every mode renders the same folder workspaces (#15362); modes choose lanes only. */
export function getRenderableFolderWorkspaces(
  folderWorkspaces: readonly FolderWorkspace[],
  projectGroups: readonly ProjectGroup[],
  /** When set, also emit each group's ephemeral group-wide workspace. */
  groupWideRepos?: readonly Repo[]
): RenderableFolderWorkspace[] {
  const projectGroupsById = new Map<string, ProjectGroup[]>()
  for (const group of projectGroups) {
    const groups = projectGroupsById.get(group.id) ?? []
    groups.push(group)
    projectGroupsById.set(group.id, groups)
  }
  const renderable: RenderableFolderWorkspace[] = []
  for (const folderWorkspace of folderWorkspaces) {
    const folderHostId =
      normalizeExecutionHostId(folderWorkspace.executionHostId) ??
      (folderWorkspace.connectionId ? toSshExecutionHostId(folderWorkspace.connectionId) : 'local')
    // Why host match: same-id groups can exist on several hosts.
    const candidates = projectGroupsById.get(folderWorkspace.projectGroupId)
    const projectGroup =
      candidates?.find((group) => getProjectGroupExecutionHostId(group) === folderHostId) ??
      candidates?.find((group) => getProjectGroupExecutionHostId(group) === 'local') ??
      candidates?.[0]
    // A group filtered out for host visibility legitimately hides its workspaces.
    if (!projectGroup?.parentPath) {
      continue
    }
    renderable.push({ folderWorkspace, projectGroup })
  }
  for (const projectGroup of groupWideRepos ? projectGroups : []) {
    const folderWorkspace = projectGroupToFolderWorkspace({
      group: projectGroup,
      projectGroups,
      repos: groupWideRepos!
    })
    if (folderWorkspace) {
      renderable.push({ folderWorkspace, projectGroup, isGroupWide: true })
    }
  }
  return renderable
}

/** Switch exhaustively so new grouping modes cannot silently hide folder workspaces again. */
export function getFolderWorkspaceLaneKey(
  pair: RenderableFolderWorkspace,
  groupBy: Exclude<WorktreeGroupBy, 'repo'>,
  workspaceStatuses: readonly WorkspaceStatusDefinition[]
): string {
  switch (groupBy) {
    case 'workspace-status':
      return getWorkspaceStatusGroupKey(getWorkspaceStatus(pair.folderWorkspace, workspaceStatuses))
    case 'pr-status':
      // Folders cannot resolve a PR; match worktrees without one in the in-progress lane.
      return getPRLaneKey('in-progress')
    case 'none':
      return ALL_GROUP_KEY
  }
}

type FolderWorkspaceDisplayOrder = Pick<
  FolderWorkspace,
  'id' | 'name' | 'sortOrder' | 'manualOrder' | 'executionHostId'
>

/** Match project-group ordering: user rank, then name. */
export function compareFolderWorkspacesForDisplay(
  left: FolderWorkspaceDisplayOrder,
  right: FolderWorkspaceDisplayOrder
): number {
  const leftOrder = left.manualOrder ?? left.sortOrder
  const rightOrder = right.manualOrder ?? right.sortOrder
  return (
    rightOrder - leftOrder ||
    compareSidebarText(left.name, right.name) ||
    compareCodePoints(left.executionHostId ?? '', right.executionHostId ?? '') ||
    compareCodePoints(left.id, right.id)
  )
}
