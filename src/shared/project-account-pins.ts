import { getRepoExecutionHostId, normalizeExecutionHostId } from './execution-host'
import type { ProjectGroup } from './project-group-types'
import { getProjectGroupExecutionHostId, getProjectGroupHostIdentity } from './project-groups'
import { getRepoHostIdentityForParts } from './repo-host-identity'
import type { Repo } from './repo-types'
import {
  PROJECT_ACCOUNT_PIN_FIELDS,
  type ProjectAccountPinField,
  type ProjectAccountPins,
  type ResolvedProjectAccountPin
} from './project-account-pin-types'

type PinnedGroup = Pick<
  ProjectGroup,
  'id' | 'name' | 'parentGroupId' | 'connectionId' | 'executionHostId'
> &
  ProjectAccountPins

function pinValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function findGroup<T extends PinnedGroup>(
  groups: readonly T[],
  groupId: string,
  hostId: string
): T | undefined {
  const identity = getRepoHostIdentityForParts(groupId, hostId)
  return (
    groups.find((group) => getProjectGroupHostIdentity(group) === identity) ??
    // Why: legacy local groups carry no host stamp; match them by id like clearMissingProjectGroupMemberships.
    groups.find(
      (group) =>
        group.id === groupId &&
        !group.connectionId &&
        !normalizeExecutionHostId(group.executionHostId)
    )
  )
}

/** Walks a group and its ancestors for the nearest group that pins `field`. */
export function resolveGroupAccountPin(
  groups: readonly PinnedGroup[],
  groupId: string | null | undefined,
  hostId: string,
  field: ProjectAccountPinField
): ResolvedProjectAccountPin {
  const visited = new Set<string>()
  let current = groupId ? findGroup(groups, groupId, hostId) : undefined
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    const value = pinValue(current[field])
    if (value) {
      return {
        value,
        source: { kind: 'group', groupId: current.id, groupName: current.name }
      }
    }
    current = current.parentGroupId
      ? findGroup(groups, current.parentGroupId, getProjectGroupExecutionHostId(current))
      : undefined
  }
  return { value: null, source: { kind: 'none' } }
}

export function resolveProjectAccountPin(
  repo: Pick<Repo, 'projectGroupId' | 'connectionId' | 'executionHostId'> & ProjectAccountPins,
  groups: readonly PinnedGroup[],
  field: ProjectAccountPinField
): ResolvedProjectAccountPin {
  const own = pinValue(repo[field])
  if (own) {
    return { value: own, source: { kind: 'project' } }
  }
  return resolveGroupAccountPin(groups, repo.projectGroupId, getRepoExecutionHostId(repo), field)
}

/** Returns repos whose pin fields hold their effective (inherited) values. */
export function applyInheritedProjectAccountPins<T extends Repo>(
  repos: readonly T[],
  groups: readonly PinnedGroup[]
): T[] {
  if (!groups.some((group) => PROJECT_ACCOUNT_PIN_FIELDS.some((field) => pinValue(group[field])))) {
    return [...repos]
  }
  return repos.map((repo) => {
    let next: T | null = null
    for (const field of PROJECT_ACCOUNT_PIN_FIELDS) {
      if (pinValue(repo[field])) {
        continue
      }
      const inherited = resolveProjectAccountPin(repo, groups, field).value
      if (inherited) {
        next ??= { ...repo }
        next[field] = inherited
      }
    }
    return next ?? repo
  })
}
