import { getRepoExecutionHostId, normalizeExecutionHostId } from './execution-host'
import type { FolderWorkspace } from './folder-workspace-types'
import type { ProjectGroup } from './project-group-types'
import { getProjectGroupSubtreeIds } from './project-groups'
import type { Repo } from './repo-types'
import { getDeepestCommonRuntimePath, getRuntimePathParent } from './cross-platform-path'
import { folderWorkspaceKey } from './workspace-scope'

const PROJECT_GROUP_WORKSPACE_ID_PREFIX = 'project-group:'

export function projectGroupWorkspaceFolderId(projectGroupId: string): string {
  return `${PROJECT_GROUP_WORKSPACE_ID_PREFIX}${projectGroupId}`
}

export function projectGroupWorkspaceKey(projectGroupId: string): string {
  return folderWorkspaceKey(projectGroupWorkspaceFolderId(projectGroupId))
}

export function getProjectGroupIdFromWorkspaceFolderId(folderWorkspaceId: string): string | null {
  if (!folderWorkspaceId.startsWith(PROJECT_GROUP_WORKSPACE_ID_PREFIX)) {
    return null
  }
  const projectGroupId = folderWorkspaceId.slice(PROJECT_GROUP_WORKSPACE_ID_PREFIX.length)
  return projectGroupId || null
}

function groupOwnsRepo(group: ProjectGroup, repo: Repo): boolean {
  if (group.executionHostId) {
    return getRepoExecutionHostId(repo) === group.executionHostId
  }
  if (group.connectionId) {
    return repo.connectionId === group.connectionId
  }
  return !repo.connectionId && getRepoExecutionHostId(repo) === 'local'
}

export function deriveProjectGroupWorkspacePath(args: {
  group: ProjectGroup
  projectGroups: readonly ProjectGroup[]
  repos: readonly Repo[]
}): string | null {
  if (args.group.parentPath) {
    return args.group.parentPath
  }
  const subtreeIds = getProjectGroupSubtreeIds(args.projectGroups, args.group.id)
  const paths = args.repos
    .filter(
      (repo) =>
        typeof repo.projectGroupId === 'string' &&
        subtreeIds.has(repo.projectGroupId) &&
        groupOwnsRepo(args.group, repo)
    )
    .map((repo) => repo.path)
  if (paths.length === 0) {
    return null
  }
  return paths.length === 1 ? getRuntimePathParent(paths[0]) : getDeepestCommonRuntimePath(paths)
}

export function projectGroupToFolderWorkspace(args: {
  group: ProjectGroup
  projectGroups: readonly ProjectGroup[]
  repos: readonly Repo[]
}): FolderWorkspace | null {
  const folderPath = deriveProjectGroupWorkspacePath(args)
  if (!folderPath) {
    return null
  }
  return {
    id: projectGroupWorkspaceFolderId(args.group.id),
    projectGroupId: args.group.id,
    name: 'Group Wide',
    folderPath,
    connectionId: args.group.connectionId ?? null,
    executionHostId: normalizeExecutionHostId(args.group.executionHostId) ?? null,
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: args.group.updatedAt,
    createdAt: args.group.createdAt,
    updatedAt: args.group.updatedAt
  }
}
