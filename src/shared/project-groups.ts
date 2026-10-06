import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  normalizeExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from './execution-host'
import { getRepoHostIdentityForParts } from './repo-host-identity'
import type { ProjectGroup, ProjectGroupCreatedFrom } from './project-group-types'
import type { Repo } from './repo-types'
import { sanitizeRepoIcon } from './repo-icon'
import { PROJECT_ACCOUNT_PIN_FIELDS, type ProjectAccountPins } from './project-account-pin-types'

export const UNGROUPED_PROJECT_GROUP_KEY = 'project-group:ungrouped'

function createProjectGroupId(): string {
  const randomUUID = globalThis.crypto?.randomUUID
  if (randomUUID) {
    return randomUUID.call(globalThis.crypto)
  }
  return `project-group-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function normalizeProjectGroupName(name: string, fallback = 'Untitled group'): string {
  const trimmed = name.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

export function createProjectGroup(input: {
  name: string
  parentPath?: string | null
  connectionId?: string | null
  parentGroupId?: string | null
  createdFrom: ProjectGroupCreatedFrom
  tabOrder: number
  now?: number
}): ProjectGroup {
  const now = input.now ?? Date.now()
  return {
    id: createProjectGroupId(),
    name: normalizeProjectGroupName(input.name),
    parentPath: input.parentPath ?? null,
    connectionId: input.connectionId ?? null,
    parentGroupId: input.parentGroupId ?? null,
    createdFrom: input.createdFrom,
    tabOrder: input.tabOrder,
    isCollapsed: false,
    color: null,
    icon: null,
    createdAt: now,
    updatedAt: now
  }
}

export function getProjectGroupExecutionHostId(
  group: Pick<ProjectGroup, 'connectionId' | 'executionHostId'>,
  defaultHostId: ExecutionHostId = LOCAL_EXECUTION_HOST_ID
): ExecutionHostId {
  const executionHostId = normalizeExecutionHostId(group.executionHostId)
  if (executionHostId) {
    return executionHostId
  }
  const connectionId = group.connectionId?.trim()
  return connectionId ? toSshExecutionHostId(connectionId) : defaultHostId
}

export function getProjectGroupHostIdentity(
  group: Pick<ProjectGroup, 'id' | 'connectionId' | 'executionHostId'>,
  defaultHostId: ExecutionHostId = LOCAL_EXECUTION_HOST_ID
): string {
  return getRepoHostIdentityForParts(group.id, getProjectGroupExecutionHostId(group, defaultHostId))
}

function normalizeProjectGroupAccountPins(raw: Partial<ProjectGroup>): ProjectAccountPins {
  const pins: ProjectAccountPins = {}
  for (const field of PROJECT_ACCOUNT_PIN_FIELDS) {
    const value = raw[field]
    if (typeof value === 'string' && value.trim()) {
      pins[field] = value
    }
  }
  return pins
}

export function normalizeProjectGroups(value: unknown): ProjectGroup[] {
  if (!Array.isArray(value)) {
    return []
  }
  const groups: ProjectGroup[] = []
  const seen = new Set<string>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') {
      continue
    }
    const raw = candidate as Partial<ProjectGroup>
    if (typeof raw.id !== 'string') {
      continue
    }
    const now = Date.now()
    const executionHostId = normalizeExecutionHostId(raw.executionHostId)
    const connectionId =
      typeof raw.connectionId === 'string'
        ? raw.connectionId
        : raw.connectionId === null
          ? null
          : null
    const identity = getProjectGroupHostIdentity({
      id: raw.id,
      connectionId,
      executionHostId
    })
    if (seen.has(identity)) {
      continue
    }
    seen.add(identity)
    groups.push({
      id: raw.id,
      name: normalizeProjectGroupName(typeof raw.name === 'string' ? raw.name : ''),
      parentPath: typeof raw.parentPath === 'string' ? raw.parentPath : null,
      connectionId,
      parentGroupId: typeof raw.parentGroupId === 'string' ? raw.parentGroupId : null,
      createdFrom:
        raw.createdFrom === 'manual' ||
        raw.createdFrom === 'folder-scan' ||
        raw.createdFrom === 'migration'
          ? raw.createdFrom
          : 'manual',
      tabOrder:
        typeof raw.tabOrder === 'number' && Number.isFinite(raw.tabOrder) ? raw.tabOrder : 0,
      isCollapsed: raw.isCollapsed === true,
      color: typeof raw.color === 'string' ? raw.color : null,
      icon: sanitizeRepoIcon(raw.icon) ?? null,
      ...normalizeProjectGroupAccountPins(raw),
      createdAt:
        typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : now,
      updatedAt:
        typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
      ...(executionHostId ? { executionHostId } : {})
    })
  }
  groups.sort(
    (left, right) => left.tabOrder - right.tabOrder || left.name.localeCompare(right.name)
  )
  const groupByIdentity = new Map(
    groups.map((group) => [getProjectGroupHostIdentity(group), group])
  )
  for (const group of groups) {
    const parentIdentity = group.parentGroupId
      ? getRepoHostIdentityForParts(group.parentGroupId, getProjectGroupExecutionHostId(group))
      : null
    if (
      !parentIdentity ||
      parentIdentity === getProjectGroupHostIdentity(group) ||
      !groupByIdentity.has(parentIdentity)
    ) {
      group.parentGroupId = null
    }
  }
  for (const group of groups) {
    const seenInChain = new Map<string, number>()
    const chain: ProjectGroup[] = []
    let current: ProjectGroup | undefined = group
    while (current) {
      const identity = getProjectGroupHostIdentity(current)
      const cycleStart = seenInChain.get(identity)
      if (cycleStart !== undefined) {
        for (const cycleGroup of chain.slice(cycleStart)) {
          cycleGroup.parentGroupId = null
        }
        break
      }
      seenInChain.set(identity, chain.length)
      chain.push(current)
      current = current.parentGroupId
        ? groupByIdentity.get(
            getRepoHostIdentityForParts(
              current.parentGroupId,
              getProjectGroupExecutionHostId(current)
            )
          )
        : undefined
    }
  }
  return groups
}

export function clearMissingProjectGroupMemberships(repos: Repo[], groups: ProjectGroup[]): Repo[] {
  const groupIdentities = new Set(groups.map((group) => getProjectGroupHostIdentity(group)))
  const legacyGroupIds = new Set(
    groups
      .filter((group) => !group.connectionId && !normalizeExecutionHostId(group.executionHostId))
      .map((group) => group.id)
  )
  return repos.map((repo) =>
    repo.projectGroupId &&
    !legacyGroupIds.has(repo.projectGroupId) &&
    !groupIdentities.has(
      getRepoHostIdentityForParts(repo.projectGroupId, getRepoExecutionHostId(repo))
    )
      ? { ...repo, projectGroupId: null }
      : repo
  )
}

export type ProjectGroupChildIndex = ReadonlyMap<string, string[]>

/** Build once and reuse when collecting subtrees for more than one root. */
export function buildProjectGroupChildIndex(
  groups: readonly Pick<ProjectGroup, 'id' | 'parentGroupId' | 'connectionId' | 'executionHostId'>[]
): ProjectGroupChildIndex {
  const childGroupsByParentIdentity = new Map<string, string[]>()
  const identities = new Set(groups.map((group) => getProjectGroupHostIdentity(group)))
  for (const group of groups) {
    if (!group.parentGroupId) {
      continue
    }
    const hostId = getProjectGroupExecutionHostId(group)
    const parentIdentity = getRepoHostIdentityForParts(group.parentGroupId, hostId)
    if (!identities.has(parentIdentity)) {
      continue
    }
    const children = childGroupsByParentIdentity.get(parentIdentity) ?? []
    children.push(group.id)
    childGroupsByParentIdentity.set(parentIdentity, children)
  }
  return childGroupsByParentIdentity
}

export function getProjectGroupSubtreeIds(
  groups: readonly Pick<
    ProjectGroup,
    'id' | 'parentGroupId' | 'connectionId' | 'executionHostId'
  >[],
  rootGroupId: string,
  rootHostId: ExecutionHostId = LOCAL_EXECUTION_HOST_ID
): Set<string> {
  return collectProjectGroupSubtreeIds(buildProjectGroupChildIndex(groups), rootGroupId, rootHostId)
}

export function collectProjectGroupSubtreeIds(
  childGroupsByParentIdentity: ProjectGroupChildIndex,
  rootGroupId: string,
  rootHostId: ExecutionHostId = LOCAL_EXECUTION_HOST_ID
): Set<string> {
  const subtreeIds = new Set<string>()
  const pending = [rootGroupId]
  while (pending.length > 0) {
    const groupId = pending.pop()!
    if (subtreeIds.has(groupId)) {
      continue
    }
    subtreeIds.add(groupId)
    // Why: imported project-group trees can be very wide; `push(...children)`
    // can exceed V8's argument limit while collecting descendants.
    for (const childGroupId of childGroupsByParentIdentity.get(
      getRepoHostIdentityForParts(groupId, rootHostId)
    ) ?? []) {
      pending.push(childGroupId)
    }
  }
  return subtreeIds
}

/** Manual rank for a project inside a group bucket. Explicit
 *  `projectGroupOrder` wins; otherwise fall back to global repo order so drag
 *  midpoint math and sidebar sorting stay aligned. */
export function getEffectiveProjectGroupManualRank(
  repo: Pick<Repo, 'id' | 'projectGroupOrder'> | undefined,
  repoOrderRankById?: ReadonlyMap<string, number>,
  siblingFallbackIndex?: number
): number {
  if (!repo) {
    return Number.POSITIVE_INFINITY
  }
  const order = repo.projectGroupOrder
  if (typeof order === 'number' && Number.isFinite(order)) {
    return order
  }
  const repoRank = repoOrderRankById?.get(repo.id)
  if (repoRank !== undefined) {
    return repoRank * 1000
  }
  if (siblingFallbackIndex !== undefined) {
    return siblingFallbackIndex * 1000
  }
  return Number.POSITIVE_INFINITY
}

export function getNextProjectGroupOrder(repos: readonly Repo[], groupId: string | null): number {
  let max = -1
  for (const repo of repos) {
    if ((repo.projectGroupId ?? null) !== groupId) {
      continue
    }
    const order = repo.projectGroupOrder
    if (typeof order === 'number' && Number.isFinite(order)) {
      max = Math.max(max, order)
    }
  }
  return max + 1
}
