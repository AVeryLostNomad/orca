import type { FolderWorkspace } from '../../../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { WorkspaceStatusDefinition, Worktree } from '../../../../../../shared/worktree/types'
import {
  folderWorkspaceToWorktree,
  getFolderWorkspaceHostIdentity
} from '../../../../../../shared/folder-workspace-worktree'
import {
  normalizeWorkspaceSessionKeyToWorkspaceId,
  parseWorkspaceKey
} from '../../../../../../shared/workspace-scope'
import {
  composeWorktreeHostIdentity,
  getExecutionHostIdFromWorktreeHostIdentity
} from '../../../../../../shared/worktree/host-qualified-identity'
import { getProjectGroupHeaderKey } from '../../../../../../shared/sidebar-list/group-keys'
import {
  LOCAL_EXECUTION_HOST_ID,
  normalizeExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../../../../shared/execution-host'
import {
  getProjectGroupExecutionHostId,
  getProjectGroupHostIdentity
} from '../../../../../../shared/project-groups'
import { getFolderWorkspaceLaneKey } from '../../../../../../shared/sidebar-list/folder-workspace-lanes'
import type { WorktreeGroupBy } from '../../../../../../shared/sidebar-list/row-types'
import { getFolderWorkspaceHostId } from '../../../../../../shared/sidebar-list/folder-workspace-host-id'
import { getHostSectionCollapseKey } from '../../../../../../shared/sidebar-list/host-section-collapse'

function findFolderWorkspaceByKey(
  worktreeId: string,
  folderWorkspaces: readonly FolderWorkspace[],
  executionHostId?: ExecutionHostId | null
): FolderWorkspace | null {
  const scope = parseWorkspaceKey(worktreeId)
  if (scope?.type !== 'folder') {
    return null
  }
  return (
    folderWorkspaces.find(
      (workspace) =>
        workspace.id === scope.folderWorkspaceId &&
        (!executionHostId ||
          getFolderWorkspaceHostIdentity(workspace) ===
            composeWorktreeHostIdentity(executionHostId, worktreeId))
    ) ?? null
  )
}

export function getKnownSidebarWorktreeById(
  worktreeId: string,
  worktreeMap: ReadonlyMap<string, Worktree>,
  folderWorkspaces: readonly FolderWorkspace[],
  worktrees?: readonly Worktree[],
  executionHostId?: ExecutionHostId | null
): Worktree | null {
  const workspaceId = normalizeWorkspaceSessionKeyToWorkspaceId(worktreeId)
  const ownerHostId = getExecutionHostIdFromWorktreeHostIdentity(worktreeId) ?? executionHostId
  const worktree = ownerHostId
    ? (worktrees?.find(
        (candidate) => candidate.id === workspaceId && candidate.hostId === ownerHostId
      ) ?? null)
    : worktreeMap.get(workspaceId)
  if (worktree) {
    return worktree
  }
  const folderWorkspace = findFolderWorkspaceByKey(workspaceId, folderWorkspaces, ownerHostId)
  return folderWorkspace ? folderWorkspaceToWorktree(folderWorkspace) : null
}

export function sidebarWorkspaceStillExists(
  worktreeId: string,
  worktrees: readonly Worktree[],
  folderWorkspaces: readonly FolderWorkspace[],
  executionHostId?: ExecutionHostId
): boolean {
  if (
    worktrees.some(
      (worktree) =>
        worktree.id === worktreeId &&
        (!executionHostId || !worktree.hostId || worktree.hostId === executionHostId)
    )
  ) {
    return true
  }
  return findFolderWorkspaceByKey(worktreeId, folderWorkspaces, executionHostId) !== null
}

export function getFolderWorkspaceRevealGroupKeys(
  worktreeId: string,
  folderWorkspaces: readonly FolderWorkspace[],
  projectGroups: readonly ProjectGroup[],
  options?: {
    groupBy?: WorktreeGroupBy
    workspaceStatuses?: readonly WorkspaceStatusDefinition[]
    defaultHostId?: ExecutionHostId
    hostScopedGroups?: boolean
    executionHostId?: ExecutionHostId
  }
): string[] {
  const folderWorkspace = findFolderWorkspaceByKey(
    worktreeId,
    folderWorkspaces,
    options?.executionHostId
  )
  if (!folderWorkspace) {
    return []
  }

  const defaultHostId = options?.defaultHostId ?? LOCAL_EXECUTION_HOST_ID
  const groupsByIdentity = new Map(
    projectGroups.map((group) => [getProjectGroupHostIdentity(group), group])
  )
  const folderHostId =
    normalizeExecutionHostId(folderWorkspace.executionHostId) ??
    (folderWorkspace.connectionId
      ? toSshExecutionHostId(folderWorkspace.connectionId)
      : defaultHostId)
  const keys: string[] = []
  const seen = new Set<string>()
  const matchingGroups = projectGroups.filter(
    (group) => group.id === folderWorkspace.projectGroupId
  )
  const owningGroup =
    groupsByIdentity.get(
      getProjectGroupHostIdentity({
        id: folderWorkspace.projectGroupId,
        connectionId: null,
        executionHostId: folderHostId
      })
    ) ??
    matchingGroups.find((group) => getProjectGroupExecutionHostId(group) === 'local') ??
    matchingGroups[0]
  let group: ProjectGroup | undefined = owningGroup
  while (group) {
    const identity = getProjectGroupHostIdentity(group)
    if (seen.has(identity)) {
      break
    }
    seen.add(identity)
    keys.unshift(getProjectGroupHeaderKey(group))
    const parentGroupId = group.parentGroupId
    group = parentGroupId
      ? groupsByIdentity.get(
          getProjectGroupHostIdentity({
            id: parentGroupId,
            connectionId: null,
            executionHostId: folderHostId
          })
        )
      : undefined
  }

  // Non-repo modes hide folders behind lane/host headers; derive their reveal keys from the grouping function.
  if (options?.groupBy && options.groupBy !== 'repo' && owningGroup) {
    const laneKey = getFolderWorkspaceLaneKey(
      { folderWorkspace, projectGroup: owningGroup },
      options.groupBy,
      options.workspaceStatuses ?? []
    )
    keys.push(
      options.hostScopedGroups && options.defaultHostId
        ? getHostSectionCollapseKey(
            laneKey,
            getFolderWorkspaceHostId(folderWorkspace, owningGroup, options.defaultHostId)
          )
        : laneKey
    )
  }
  if (owningGroup && options?.defaultHostId) {
    keys.push(
      `host:${getFolderWorkspaceHostId(folderWorkspace, owningGroup, options.defaultHostId)}`
    )
  }
  return keys
}
