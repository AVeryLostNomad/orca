import {
  compareFolderWorkspacesForDisplay,
  type RenderableFolderWorkspace
} from './folder-workspace-lanes'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import { getRepoExecutionHostId } from '../../../../../../shared/execution-host'
import {
  getEffectiveProjectGroupManualRank,
  getProjectGroupExecutionHostId,
  getProjectGroupHostIdentity
} from '../../../../../../shared/project-groups'
import type { ProjectOrderBy } from '../../../../../../shared/ui-chrome-types'
import { appendOrderedGroups } from './group-sections'
import type { SectionAppendContext } from './group-sections'
import type { OrderedGroupEntry } from './project-grouping'
import {
  compareRecentRank,
  recentRankForEntry,
  withRepoSectionDisplayLabels
} from './section-order'
import { buildFolderWorkspaceRow } from './row-builders'
import { getProjectGroupHeaderKey, PROJECT_GROUP_META } from './group-keys'

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
      return [...entries].sort((left, right) =>
        compareRecentRank(recentRankForEntry(left), recentRankForEntry(right))
      )
    }
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
        leftGroup.tabOrder - rightGroup.tabOrder || leftGroup.name.localeCompare(rightGroup.name)
      )
    })
  }

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

  const pendingGroups = (childGroupIdentitiesByParentIdentity.get(null) ?? [])
    .toReversed()
    .map((identity): [string, number] => [identity, 0])
  while (pendingGroups.length > 0) {
    const [identity, depth] = pendingGroups.pop()!
    const projectGroup = groupsByIdentity.get(identity)!
    const key = getProjectGroupHeaderKey(projectGroup)
    result.push({
      type: 'header',
      key,
      label: projectGroup.name,
      count: subtreeCounts.get(identity) ?? 0,
      tone: PROJECT_GROUP_META.tone,
      icon: PROJECT_GROUP_META.icon,
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
    remainingRepoEntries.push(...entries)
  }
  appendOrderedGroups(
    ctx,
    withRepoSectionDisplayLabels(sortRepoEntriesWithinGroup(remainingRepoEntries)),
    0
  )
}
