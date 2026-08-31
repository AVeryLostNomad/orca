import type { FolderWorkspace } from '../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../shared/project-group-types'
import type { Repo } from '../../../shared/repo-types'
import { isPathInsideOrEqual } from '../../../shared/cross-platform-path'
import { getProjectGroupSubtreeIds } from '../../../shared/project-groups'
import {
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../shared/execution-host'
import {
  getProjectGroupIdFromWorkspaceFolderId,
  projectGroupToFolderWorkspace
} from '../../../shared/project-group-workspace'

export type FolderWorkspaceConnectionState = {
  folderWorkspaces: readonly FolderWorkspace[]
  projectGroups: readonly ProjectGroup[]
  repos: readonly Repo[]
}

function belongsToExecutionHost(
  owner: Pick<FolderWorkspace | ProjectGroup, 'connectionId' | 'executionHostId'>,
  executionHostId?: ExecutionHostId
): boolean {
  if (!executionHostId) {
    return true
  }
  const ownerHostId =
    parseExecutionHostId(owner.executionHostId)?.id ??
    (owner.connectionId ? toSshExecutionHostId(owner.connectionId) : LOCAL_EXECUTION_HOST_ID)
  return ownerHostId === executionHostId
}

export function resolveFolderWorkspaceForState(
  state: FolderWorkspaceConnectionState,
  folderWorkspaceId: string,
  executionHostId?: ExecutionHostId
): FolderWorkspace | null {
  const persisted = state.folderWorkspaces.find(
    (entry) => entry.id === folderWorkspaceId && belongsToExecutionHost(entry, executionHostId)
  )
  if (persisted) {
    return persisted
  }
  const projectGroupId = getProjectGroupIdFromWorkspaceFolderId(folderWorkspaceId)
  const group = projectGroupId
    ? state.projectGroups.find(
        (candidate) =>
          candidate.id === projectGroupId && belongsToExecutionHost(candidate, executionHostId)
      )
    : undefined
  return group
    ? projectGroupToFolderWorkspace({
        group,
        projectGroups: state.projectGroups,
        repos: state.repos
      })
    : null
}

function getFolderScopeCandidateRepos(args: {
  folderPath: string
  projectGroupId: string
  connectionId?: string | null
  projectGroups: readonly ProjectGroup[]
  repos: readonly Repo[]
}): Repo[] {
  const groupIds = getProjectGroupSubtreeIds(args.projectGroups, args.projectGroupId)
  const groupRepos = args.repos.filter(
    (repo) => typeof repo.projectGroupId === 'string' && groupIds.has(repo.projectGroupId)
  )
  const pathRepos = args.repos.filter(
    (repo) =>
      !(typeof repo.projectGroupId === 'string' && groupIds.has(repo.projectGroupId)) &&
      isPathInsideOrEqual(args.folderPath, repo.path)
  )
  if (args.connectionId) {
    return [
      ...groupRepos,
      ...pathRepos.filter((repo) => (repo.connectionId ?? null) === args.connectionId)
    ]
  }
  if (groupRepos.length === 0) {
    return pathRepos
  }
  const groupConnectionIds = new Set(groupRepos.map((repo) => repo.connectionId ?? null))
  return [
    ...groupRepos,
    ...pathRepos.filter((repo) => groupConnectionIds.has(repo.connectionId ?? null))
  ]
}

export function getFolderWorkspaceCandidateRepos(
  state: FolderWorkspaceConnectionState,
  folderWorkspaceId: string
): Repo[] {
  const workspace = resolveFolderWorkspaceForState(state, folderWorkspaceId)
  if (!workspace) {
    return []
  }
  const group = state.projectGroups.find((entry) => entry.id === workspace.projectGroupId)
  return getFolderScopeCandidateRepos({
    folderPath: workspace.folderPath,
    projectGroupId: workspace.projectGroupId,
    connectionId: workspace.connectionId ?? group?.connectionId ?? null,
    projectGroups: state.projectGroups,
    repos: state.repos
  })
}

export function getFolderWorkspaceConnectionId(
  state: FolderWorkspaceConnectionState,
  folderWorkspaceId: string
): string | null | undefined {
  const workspace = resolveFolderWorkspaceForState(state, folderWorkspaceId)
  if (!workspace) {
    return undefined
  }
  const explicitHost = parseExecutionHostId(workspace.executionHostId)
  if (explicitHost) {
    return explicitHost.kind === 'ssh' ? explicitHost.targetId : null
  }
  const scopeConnectionId =
    workspace.connectionId ??
    state.projectGroups.find((entry) => entry.id === workspace.projectGroupId)?.connectionId ??
    null
  const candidateRepos = getFolderWorkspaceCandidateRepos(state, folderWorkspaceId)
  let hasLocalRepo = false
  const connectionIds = new Set<string>()
  for (const repo of candidateRepos) {
    if (repo.connectionId) {
      connectionIds.add(repo.connectionId)
    } else {
      hasLocalRepo = true
    }
  }
  if (scopeConnectionId) {
    const hasDifferentSshConnection = [...connectionIds].some(
      (connectionId) => connectionId !== scopeConnectionId
    )
    if (hasLocalRepo || hasDifferentSshConnection) {
      return undefined
    }
    return scopeConnectionId
  }
  if (candidateRepos.length === 0) {
    return null
  }
  if (hasLocalRepo && connectionIds.size > 0) {
    return undefined
  }
  if (connectionIds.size === 0) {
    return null
  }
  if (connectionIds.size === 1) {
    return [...connectionIds][0]
  }
  return undefined
}
