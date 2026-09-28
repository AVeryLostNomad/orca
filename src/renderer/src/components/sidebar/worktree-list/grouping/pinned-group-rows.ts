import type { Repo } from '../../../../../../shared/repo-types'
import type { WorktreeLineage } from '../../../../../../shared/worktree/lineage-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import { PINNED_GROUP_KEY, PINNED_GROUP_META } from './group-keys'
import { appendWorktreeRows, buildImportedWorktreesCardRow } from './row-builders'
import type { ImportedWorktreesCardCandidate, Row } from './row-types'

export function emitPinnedGroup(
  pinnedSectionWorktrees: Worktree[],
  repoMap: Map<string, Repo>,
  collapsedGroups: Set<string>,
  renderedNaturalAnchorRepoIds: ReadonlySet<string>,
  importedWorktreesByRepo: ReadonlyMap<string, ImportedWorktreesCardCandidate>,
  allowImportedFallback: boolean,
  result: Row[],
  lineageById: Record<string, WorktreeLineage>,
  worktreeMap: Map<string, Worktree>,
  nestLineage: boolean,
  cyclicLineageIds: ReadonlySet<string>
): void {
  if (pinnedSectionWorktrees.length === 0) {
    return
  }
  const pinnedRepoOrder: string[] = []
  const seenPinnedRepoIds = new Set<string>()
  for (const worktree of pinnedSectionWorktrees) {
    if (!seenPinnedRepoIds.has(worktree.repoId)) {
      pinnedRepoOrder.push(worktree.repoId)
      seenPinnedRepoIds.add(worktree.repoId)
    }
  }

  result.push({
    type: 'header',
    key: PINNED_GROUP_KEY,
    label: PINNED_GROUP_META.label,
    count: pinnedSectionWorktrees.length,
    tone: PINNED_GROUP_META.tone,
    icon: PINNED_GROUP_META.icon,
    worktreeIds: pinnedSectionWorktrees.map((worktree) => worktree.id)
  })
  if (collapsedGroups.has(PINNED_GROUP_KEY)) {
    for (const repoId of pinnedRepoOrder) {
      const candidate = importedWorktreesByRepo.get(repoId)
      if (allowImportedFallback && candidate && !renderedNaturalAnchorRepoIds.has(repoId)) {
        result.push(buildImportedWorktreesCardRow(candidate, 'pinned-fallback'))
      }
    }
    return
  }

  const firstItemIndex = result.length
  appendWorktreeRows(result, pinnedSectionWorktrees, repoMap, lineageById, worktreeMap, {
    nestLineage,
    collapsedGroups,
    groupDepth: 0,
    sectionKey: PINNED_GROUP_KEY,
    cyclicLineageIds
  })
  if (!allowImportedFallback) {
    return
  }
  // Why: imported fallback sits after the last row of that repo; splice from the
  // end so earlier inserts do not shift later targets.
  const lastResultIndexByRepoId = new Map<string, number>()
  for (let index = firstItemIndex; index < result.length; index++) {
    const row = result[index]
    if (row?.type === 'item') {
      lastResultIndexByRepoId.set(row.worktree.repoId, index)
    }
  }
  const inserts = [...lastResultIndexByRepoId.entries()].sort((left, right) => right[1] - left[1])
  for (const [repoId, index] of inserts) {
    const candidate = importedWorktreesByRepo.get(repoId)
    if (candidate && !renderedNaturalAnchorRepoIds.has(repoId)) {
      result.splice(index + 1, 0, buildImportedWorktreesCardRow(candidate, 'pinned-fallback'))
    }
  }
}
