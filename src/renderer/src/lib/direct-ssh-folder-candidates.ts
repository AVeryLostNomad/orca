import { normalizeExecutionHostId, toSshExecutionHostId } from '../../../shared/execution-host'
import { isPathInsideOrEqual } from '../../../shared/cross-platform-path'
import { getProjectGroupSubtreeIds } from '../../../shared/project-groups'
import type {
  DirectSshFolderOwner as FolderOwner,
  DirectSshGroupOwner as GroupOwner,
  DirectSshRepoOwner as RepoOwner
} from './direct-ssh-target-scope-types'

export function getFolderCandidateRepos(
  folder: FolderOwner,
  group: GroupOwner | undefined,
  groups: readonly GroupOwner[],
  repos: readonly RepoOwner[],
  scopeConnectionId: string | null
): RepoOwner[] {
  const groupIds = getProjectGroupSubtreeIds(
    groups,
    folder.projectGroupId,
    normalizeExecutionHostId(group?.executionHostId) ??
      (group?.connectionId ? toSshExecutionHostId(group.connectionId) : 'local')
  )
  const groupRepos = repos.filter(
    (repo) => typeof repo.projectGroupId === 'string' && groupIds.has(repo.projectGroupId)
  )
  const pathRepos = repos.filter(
    (repo) =>
      !(typeof repo.projectGroupId === 'string' && groupIds.has(repo.projectGroupId)) &&
      isPathInsideOrEqual(folder.folderPath, repo.path)
  )
  if (scopeConnectionId) {
    return [
      ...groupRepos,
      ...pathRepos.filter((repo) => (repo.connectionId ?? null) === scopeConnectionId)
    ]
  }
  if (groupRepos.length === 0) {
    return pathRepos
  }
  const groupConnections = new Set(groupRepos.map((repo) => repo.connectionId ?? null))
  return [
    ...groupRepos,
    ...pathRepos.filter((repo) => groupConnections.has(repo.connectionId ?? null))
  ]
}
