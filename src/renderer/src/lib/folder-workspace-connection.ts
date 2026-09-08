import type { Repo } from '../../../shared/repo-types'
import type { FolderWorkspace } from '../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../shared/project-group-types'
import { isPathInsideOrEqual } from '../../../shared/cross-platform-path'
import { getProjectGroupSubtreeIds } from '../../../shared/project-groups'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../shared/execution-host'
import {
  getProjectGroupIdFromWorkspaceFolderId,
  projectGroupToFolderWorkspace
} from '../../../shared/project-group-workspace'
import {
  findFolderWorkspaceCandidateRepos,
  resolveFolderWorkspaceHost,
  type FolderWorkspaceHostState
} from '../../../shared/folder-workspace-execution-host'

export type FolderWorkspaceConnectionState = FolderWorkspaceHostState

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

function getGroupWideWorkspaceCandidateRepos(args: {
  folderPath: string
  projectGroupId: string
  connectionId?: string | null
  executionHostId?: ExecutionHostId | null
  projectGroups: readonly ProjectGroup[]
  repos: readonly Repo[]
}): Repo[] {
  const belongsToWorkspace = (repo: Repo): boolean => {
    if (args.executionHostId) {
      return getRepoExecutionHostId(repo) === args.executionHostId
    }
    if (args.connectionId) {
      return repo.connectionId === args.connectionId
    }
    return !repo.connectionId && getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID
  }
  const groupIds = getProjectGroupSubtreeIds(args.projectGroups, args.projectGroupId)
  const groupRepos = args.repos.filter(
    (repo) =>
      typeof repo.projectGroupId === 'string' &&
      groupIds.has(repo.projectGroupId) &&
      belongsToWorkspace(repo)
  )
  const pathRepos = args.repos.filter(
    (repo) =>
      !(typeof repo.projectGroupId === 'string' && groupIds.has(repo.projectGroupId)) &&
      belongsToWorkspace(repo) &&
      isPathInsideOrEqual(args.folderPath, repo.path)
  )
  return groupRepos.length === 0 ? pathRepos : [...groupRepos, ...pathRepos]
}

export function getFolderWorkspaceCandidateRepos(
  state: FolderWorkspaceConnectionState,
  folderWorkspaceId: string
): Repo[] {
  const projectGroupId = getProjectGroupIdFromWorkspaceFolderId(folderWorkspaceId)
  if (!projectGroupId) {
    return findFolderWorkspaceCandidateRepos(state, folderWorkspaceId)
  }
  const workspace = resolveFolderWorkspaceForState(state, folderWorkspaceId)
  if (!workspace) {
    return []
  }
  const group = state.projectGroups.find((entry) => entry.id === workspace.projectGroupId)
  return getGroupWideWorkspaceCandidateRepos({
    folderPath: workspace.folderPath,
    projectGroupId: workspace.projectGroupId,
    connectionId: workspace.connectionId ?? group?.connectionId ?? null,
    executionHostId: workspace.executionHostId,
    projectGroups: state.projectGroups,
    repos: state.repos
  })
}

/** Legacy tri-state view of the shared resolution: `undefined` = gone or ambiguous. */
export function getFolderWorkspaceConnectionId(
  state: FolderWorkspaceConnectionState,
  folderWorkspaceId: string
): string | null | undefined {
  const host = resolveFolderWorkspaceHost(state, folderWorkspaceId)
  if (host.kind === 'ssh') {
    return host.targetId
  }
  if (host.kind === 'local') {
    return null
  }
  const workspace = resolveFolderWorkspaceForState(state, folderWorkspaceId)
  return workspace ? (workspace.connectionId ?? null) : undefined
}
