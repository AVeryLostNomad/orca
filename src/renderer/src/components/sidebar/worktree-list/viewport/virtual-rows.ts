import { defaultRangeExtractor } from '@tanstack/react-virtual'
import type { Range, VirtualItem } from '@tanstack/react-virtual'
import {
  PINNED_GROUP_KEY,
  getWorktreeLineageGroupKey
} from '../../../../../../shared/sidebar-list/group-keys'
import { getRenderRowKey } from '../listing/render-row'
import type { RenderRow } from '../listing/render-row'

export const GROUP_HEADER_ROW_HEIGHT = 28
// Host section headers are not rendered (host pages replace them); kept for shared row parity.
export const HOST_HEADER_ROW_HEIGHT = 36
export const WORKTREE_SIDEBAR_VIRTUAL_ROW_GAP = 6
const SECONDARY_GROUP_HEADER_TOP_MARGIN = 4
const IMPORTED_WORKTREES_LINE_ROW_HEIGHT = 36
const PENDING_CREATION_ROW_HEIGHT = 56
const FOLDER_WORKSPACE_ROW_HEIGHT = 64

/** Remap anchors when first/last child changes flip a parent between plain and lineage-group keys without moving it. */
export function buildLineageRowRekeyMap(rows: readonly RenderRow[]): ReadonlyMap<string, string> {
  const rekeyed = new Map<string, string>()
  for (const row of rows) {
    if (row.type === 'lineage-group') {
      const groupKey = getRenderRowKey(row)
      for (const member of row.rows) {
        rekeyed.set(`wt:${member.rowKey}`, groupKey)
      }
      continue
    }
    if (row.type !== 'item') {
      continue
    }
    // Map dissolved groups even with zero children because old anchors still hold their group key.
    rekeyed.set(
      `lineage-group:${row.sectionKey}:${getWorktreeLineageGroupKey(row.worktree)}`,
      getRenderRowKey(row)
    )
  }
  return rekeyed
}

export function shouldUseHeaderTopSpacing(args: {
  rows: readonly RenderRow[]
  index: number
  firstHeaderIndex: number
}): boolean {
  const previousRenderRow = args.rows[args.index - 1]
  const followsCollapsedPinnedHeader =
    previousRenderRow?.type === 'header' && previousRenderRow.key === PINNED_GROUP_KEY
  return args.index !== args.firstHeaderIndex && !followsCollapsedPinnedHeader
}

export function estimateRenderRowSize(
  rows: readonly RenderRow[],
  index: number,
  firstHeaderIndex: number,
  _activeStickyHeaderIndex: number | null
): number {
  const row = rows[index]
  if (row?.type === 'header') {
    return (
      GROUP_HEADER_ROW_HEIGHT +
      (shouldUseHeaderTopSpacing({
        rows,
        index,
        firstHeaderIndex
      })
        ? SECONDARY_GROUP_HEADER_TOP_MARGIN
        : 0)
    )
  }
  if (row?.type === 'lineage-group') {
    return 100 + Math.max(0, row.rows.length - 1) * 96
  }
  if (row?.type === 'imported-worktrees-card' || row?.type === 'new-external-worktrees-inbox') {
    return IMPORTED_WORKTREES_LINE_ROW_HEIGHT
  }
  if (row?.type === 'pending-creation') {
    return PENDING_CREATION_ROW_HEIGHT
  }
  if (row?.type === 'folder-workspace') {
    return FOLDER_WORKSPACE_ROW_HEIGHT
  }
  return 116
}

export function getVirtualRowTransform(start: number): string {
  return `translateY(${start}px)`
}

export function getVirtualRowIndex(element: Element): number | null {
  const index = Number.parseInt(element.getAttribute('data-index') ?? '', 10)
  return Number.isNaN(index) ? null : index
}

export function getVirtualRowKey(element: Element): string | null {
  return element.getAttribute('data-worktree-virtual-row-key')
}

export function getWorktreeVirtualRowTransform(start: number, previewOffset: number): string {
  const base = getVirtualRowTransform(start)
  return previewOffset === 0 ? base : `${base} translateY(${previewOffset}px)`
}

type VirtualRowElementCache<TElement extends Element> = {
  elementsCache: Map<unknown, TElement>
  measureElement: (node: TElement | null) => void
}

export function pruneStaleVirtualRowElementCache<TElement extends Element>({
  activeRowKeys,
  virtualizer
}: {
  activeRowKeys: ReadonlySet<string>
  virtualizer: VirtualRowElementCache<TElement>
}): void {
  virtualizer.measureElement(null)
  for (const [key, element] of virtualizer.elementsCache) {
    const rowKey = String(key)
    if (activeRowKeys.has(rowKey) || element.isConnected) {
      continue
    }
    // Drop disconnected measured nodes after TanStack cleanup so their React fibers cannot retain old card scopes.
    virtualizer.elementsCache.delete(key)
  }
}

export function getStickyHeaderIndexes(rows: readonly RenderRow[]): number[] {
  const indexes: number[] = []
  rows.forEach((row, index) => {
    // Why: project groups are the top-level repo sidebar context; nested repo
    // headers should not replace their containing group as the pinned header.
    if (row.type === 'header' && (row.projectGroupDepth ?? 0) === 0) {
      indexes.push(index)
    }
  })
  return indexes
}

/** The group header pinned at the top of the worktree list for this scroll position. */
export function getActiveWorktreeStickyHeaderIndex(args: {
  rangeStartIndex: number
  scrollOffset: number
  stickyHeaderIndexes: readonly number[]
  virtualItems: readonly VirtualItem[]
}): number | null {
  const candidateIndex = getActiveStickyHeaderIndex(args.stickyHeaderIndexes, args.rangeStartIndex)
  if (candidateIndex === null) {
    return null
  }
  const previousIndex = getPreviousStickyHeaderIndex(args.stickyHeaderIndexes, candidateIndex)
  const candidate = args.virtualItems.find((item) => item.index === candidateIndex)
  if (!candidate) {
    // Why: scrollToIndex/reveal can advance rangeStartIndex before TanStack mounts the
    // candidate row; keep a mounted previous header rather than pin one without geometry (#10088).
    const previousMounted =
      previousIndex !== null && args.virtualItems.some((item) => item.index === previousIndex)
    return previousMounted ? previousIndex : candidateIndex
  }
  // Why: hand off the moment the incoming header reaches the top of the viewport.
  if (args.scrollOffset >= candidate.start) {
    return candidateIndex
  }
  return previousIndex ?? candidateIndex
}

export function getActiveStickyHeaderIndex(
  stickyHeaderIndexes: readonly number[],
  rangeStartIndex: number
): number | null {
  for (let index = stickyHeaderIndexes.length - 1; index >= 0; index--) {
    const headerIndex = stickyHeaderIndexes[index]
    if (headerIndex <= rangeStartIndex) {
      return headerIndex
    }
  }
  return null
}

export function getPreviousStickyHeaderIndex(
  stickyHeaderIndexes: readonly number[],
  headerIndex: number
): number | null {
  const currentPosition = stickyHeaderIndexes.indexOf(headerIndex)
  if (currentPosition <= 0) {
    return null
  }
  return stickyHeaderIndexes[currentPosition - 1] ?? null
}

export function extractWorktreeVirtualRowIndexes(args: {
  range: Range
  stickyHeaderIndexes: readonly number[]
}): number[] {
  const activeStickyHeaderIndex = getActiveStickyHeaderIndex(
    args.stickyHeaderIndexes,
    args.range.startIndex
  )
  if (activeStickyHeaderIndex === null) {
    return defaultRangeExtractor(args.range)
  }

  const previousStickyHeaderIndex = getPreviousStickyHeaderIndex(
    args.stickyHeaderIndexes,
    activeStickyHeaderIndex
  )
  return Array.from(
    new Set([
      activeStickyHeaderIndex,
      ...(previousStickyHeaderIndex === null ? [] : [previousStickyHeaderIndex]),
      ...defaultRangeExtractor(args.range)
    ])
  ).sort((a, b) => a - b)
}

export function getActiveStickyHeaderIndexForScroll(args: {
  rangeStartIndex: number
  scrollOffset: number
  stickyHeaderIndexes: readonly number[]
  virtualItems: readonly VirtualItem[]
}): number | null {
  const candidateIndex = getActiveStickyHeaderIndex(args.stickyHeaderIndexes, args.rangeStartIndex)
  if (candidateIndex === null) {
    return null
  }

  const candidate = args.virtualItems.find((item) => item.index === candidateIndex)
  if (!candidate) {
    return candidateIndex
  }

  // Pin as the header reaches the top; waiting for its spacer would leave the previous header covering it.
  if (args.scrollOffset >= candidate.start) {
    return candidateIndex
  }

  return getPreviousStickyHeaderIndex(args.stickyHeaderIndexes, candidateIndex) ?? candidateIndex
}
