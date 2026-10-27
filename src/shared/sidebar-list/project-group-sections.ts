import type { OccurrenceSectionPath } from '../worktree-occurrence-plan'
import {
  compareFolderWorkspacesForDisplay,
  type RenderableFolderWorkspace
} from './folder-workspace-lanes'
import type { ProjectGroup } from '../project-group-types'
import type { ProjectOrderBy } from '../ui-chrome-types'
import { getRepoExecutionHostId } from '../execution-host'
import {
  getEffectiveProjectGroupManualRank,
  getProjectGroupExecutionHostId,
  getProjectGroupHostIdentity
} from '../project-groups'
import { getProjectGroupHeaderKey } from './group-keys'
import { appendOrderedGroups } from './group-sections'
import { compareCodePoints, compareSidebarText } from './text-order'
import type { SectionAppendContext } from './group-sections'
import type { OrderedGroupEntry } from './worktree-group-entry'
import {
  compareRecentRank,
  createRecentRankLookup,
  withRepoSectionDisplayLabels
} from '../project-section-order'
import { buildFolderWorkspaceRow } from './row-builders'

export function appendProjectGroupSections(
  ctx: SectionAppendContext,
  args: {
    orderedGroups: OrderedGroupEntry[]
    projectGroups: readonly ProjectGroup[]
    folderWorkspaces: readonly RenderableFolderWorkspace[]
    projectOrderBy: ProjectOrderBy
    repoOrder: Map<string, number> | undefined
  }
): void {
  const { orderedGroups, projectGroups, folderWorkspaces, projectOrderBy, repoOrder } = args
  const { result, collapsedGroups } = ctx

  // Why host identity: the same group id can be registered on several hosts.
  const groupByProjectGroupIdentity = new Map<string | null, OrderedGroupEntry[]>()
  for (const entry of orderedGroups) {
    const repo = entry[1].repo
    const projectGroupIdentity = repo?.projectGroupId
      ? getProjectGroupHostIdentity({
          id: repo.projectGroupId,
          connectionId: null,
          executionHostId: getRepoExecutionHostId(repo)
        })
      : null
    const entries = groupByProjectGroupIdentity.get(projectGroupIdentity) ?? []
    entries.push(entry)
    groupByProjectGroupIdentity.set(projectGroupIdentity, entries)
  }

  const sortRepoEntriesWithinGroup = (entries: OrderedGroupEntry[]): OrderedGroupEntry[] => {
    if (projectOrderBy === 'recent') {
      if (entries.length < 2) {
        return [...entries]
      }
      const getRecentRank = createRecentRankLookup()
      return [...entries].sort((left, right) =>
        compareRecentRank(getRecentRank(left), getRecentRank(right))
      )
    }
    // Use projectGroupOrder with repoOrder fallback so drag midpoint ranks match rendered order.
    return [...entries].sort((left, right) => {
      const leftRank = getEffectiveProjectGroupManualRank(left[1].repo, repoOrder)
      const rightRank = getEffectiveProjectGroupManualRank(right[1].repo, repoOrder)
      return leftRank - rightRank
    })
  }

  const groupsByIdentity = new Map<string, ProjectGroup>()
  for (const group of projectGroups) {
    const identity = getProjectGroupHostIdentity(group)
    if (!groupsByIdentity.has(identity)) {
      groupsByIdentity.set(identity, group)
    }
  }
  // Folder membership is already resolved above grouping; only group/order here (#15362).
  const folderWorkspacesByProjectGroupIdentity = new Map<string, RenderableFolderWorkspace[]>()
  for (const pair of folderWorkspaces) {
    const identity = getProjectGroupHostIdentity(pair.projectGroup)
    const pairs = folderWorkspacesByProjectGroupIdentity.get(identity) ?? []
    pairs.push(pair)
    folderWorkspacesByProjectGroupIdentity.set(identity, pairs)
  }
  for (const pairs of folderWorkspacesByProjectGroupIdentity.values()) {
    pairs.sort((left, right) =>
      compareFolderWorkspacesForDisplay(left.folderWorkspace, right.folderWorkspace)
    )
  }

  const parentIdentityByGroupIdentity = new Map<string, string | null>()
  for (const [identity, group] of groupsByIdentity) {
    const parentIdentity = group.parentGroupId
      ? getProjectGroupHostIdentity({
          id: group.parentGroupId,
          connectionId: null,
          executionHostId: getProjectGroupExecutionHostId(group)
        })
      : null
    parentIdentityByGroupIdentity.set(
      identity,
      parentIdentity && parentIdentity !== identity && groupsByIdentity.has(parentIdentity)
        ? parentIdentity
        : null
    )
  }
  for (const identity of groupsByIdentity.keys()) {
    const chain: string[] = []
    const chainIndex = new Map<string, number>()
    let currentIdentity: string | null = identity
    while (currentIdentity) {
      const cycleStart = chainIndex.get(currentIdentity)
      if (cycleStart !== undefined) {
        for (const cycleIdentity of chain.slice(cycleStart)) {
          parentIdentityByGroupIdentity.set(cycleIdentity, null)
        }
        break
      }
      chainIndex.set(currentIdentity, chain.length)
      chain.push(currentIdentity)
      currentIdentity = parentIdentityByGroupIdentity.get(currentIdentity) ?? null
    }
  }

  const childGroupIdentitiesByParentIdentity = new Map<string | null, string[]>()
  for (const [identity, parentIdentity] of parentIdentityByGroupIdentity) {
    const children = childGroupIdentitiesByParentIdentity.get(parentIdentity) ?? []
    children.push(identity)
    childGroupIdentitiesByParentIdentity.set(parentIdentity, children)
  }
  for (const childIdentities of childGroupIdentitiesByParentIdentity.values()) {
    childIdentities.sort((left, right) => {
      const leftGroup = groupsByIdentity.get(left)!
      const rightGroup = groupsByIdentity.get(right)!
      return (
        leftGroup.tabOrder - rightGroup.tabOrder ||
        compareSidebarText(leftGroup.name, rightGroup.name) ||
        compareCodePoints(leftGroup.executionHostId ?? '', rightGroup.executionHostId ?? '') ||
        compareCodePoints(leftGroup.id, rightGroup.id)
      )
    })
  }

  // Iterative post-order: wide/deep imported trees must not overflow the stack.
  const subtreeCounts = new Map<string, number>()
  for (const rootIdentity of childGroupIdentitiesByParentIdentity.get(null) ?? []) {
    const pending: [string, boolean][] = [[rootIdentity, false]]
    while (pending.length > 0) {
      const [identity, visited] = pending.pop()!
      if (visited) {
        let count =
          (groupByProjectGroupIdentity.get(identity)?.length ?? 0) +
          (folderWorkspacesByProjectGroupIdentity.get(identity)?.length ?? 0)
        for (const childIdentity of childGroupIdentitiesByParentIdentity.get(identity) ?? []) {
          count += subtreeCounts.get(childIdentity) ?? 0
        }
        subtreeCounts.set(identity, count)
        continue
      }
      pending.push([identity, true])
      for (const childIdentity of childGroupIdentitiesByParentIdentity.get(identity) ?? []) {
        pending.push([childIdentity, false])
      }
    }
  }

  // Why: a project moved between hosts can leave a same-id copy behind; skip the empty copy (#30045).
  const populatedGroupIds = new Set<string>()
  for (const [identity, count] of subtreeCounts) {
    if (count > 0) {
      populatedGroupIds.add(groupsByIdentity.get(identity)!.id)
    }
  }
  const sameIdCopyCounts = new Map<string, number>()
  for (const group of groupsByIdentity.values()) {
    sameIdCopyCounts.set(group.id, (sameIdCopyCounts.get(group.id) ?? 0) + 1)
  }
  const isEmptyDuplicateCopy = (identity: string): boolean => {
    const group = groupsByIdentity.get(identity)!
    return (
      (subtreeCounts.get(identity) ?? 0) === 0 &&
      (sameIdCopyCounts.get(group.id) ?? 0) > 1 &&
      populatedGroupIds.has(group.id)
    )
  }

  const pendingGroups = (childGroupIdentitiesByParentIdentity.get(null) ?? [])
    .toReversed()
    .map((identity): [string, number] => [identity, 0])
  while (pendingGroups.length > 0) {
    const [identity, depth] = pendingGroups.pop()!
    if (isEmptyDuplicateCopy(identity)) {
      continue
    }
    const projectGroup = groupsByIdentity.get(identity)!
    const key = getProjectGroupHeaderKey(projectGroup)
    result.push({
      type: 'header',
      key,
      label: projectGroup.name,
      count: subtreeCounts.get(identity) ?? 0,
      icon: { kind: 'project' },
      projectGroup,
      projectGroupDepth: depth
    })
    if (collapsedGroups.has(key)) {
      continue
    }
    for (const pair of folderWorkspacesByProjectGroupIdentity.get(identity) ?? []) {
      result.push(buildFolderWorkspaceRow(pair, depth + 1))
    }
    appendOrderedGroups(
      ctx,
      withRepoSectionDisplayLabels(
        sortRepoEntriesWithinGroup(groupByProjectGroupIdentity.get(identity) ?? [])
      ),
      depth + 1
    )
    const childIdentities = childGroupIdentitiesByParentIdentity.get(identity) ?? []
    for (let index = childIdentities.length - 1; index >= 0; index -= 1) {
      pendingGroups.push([childIdentities[index], depth + 1])
    }
  }

  const remainingRepoEntries = [...(groupByProjectGroupIdentity.get(null) ?? [])]
  for (const [identity, entries] of groupByProjectGroupIdentity) {
    if (identity === null || groupsByIdentity.has(identity)) {
      continue
    }
    // Keep repos visible while host project-group metadata is still loading.
    remainingRepoEntries.push(...entries)
  }
  appendOrderedGroups(
    ctx,
    withRepoSectionDisplayLabels(sortRepoEntriesWithinGroup(remainingRepoEntries)),
    0
  )
}

/** The same group parents used by section emission, keyed by host-qualified group identity. */
export function getProjectGroupOccurrencePaths(projectGroups: readonly ProjectGroup[]) {
  const groupsByIdentity = new Map(
    projectGroups.map((group) => [getProjectGroupHostIdentity(group), group])
  )
  const parentIdentityOf = (group: ProjectGroup): string | null =>
    group.parentGroupId
      ? getProjectGroupHostIdentity({
          id: group.parentGroupId,
          connectionId: null,
          executionHostId: getProjectGroupExecutionHostId(group)
        })
      : null
  const paths = new Map<string, OccurrenceSectionPath>()
  for (const [identity, group] of groupsByIdentity) {
    const pending: [string, ProjectGroup][] = []
    const seen = new Set<string>()
    let currentIdentity: string | null = identity
    let current: ProjectGroup | undefined = group
    while (
      current &&
      currentIdentity &&
      !paths.has(currentIdentity) &&
      !seen.has(currentIdentity)
    ) {
      seen.add(currentIdentity)
      pending.push([currentIdentity, current])
      currentIdentity = parentIdentityOf(current)
      current = currentIdentity ? groupsByIdentity.get(currentIdentity) : undefined
    }
    let parent = currentIdentity ? paths.get(currentIdentity) : undefined
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const [entryIdentity, entry] = pending[index]
      const path: OccurrenceSectionPath = { key: getProjectGroupHeaderKey(entry), parent }
      paths.set(entryIdentity, path)
      parent = path
    }
  }
  return paths
}
