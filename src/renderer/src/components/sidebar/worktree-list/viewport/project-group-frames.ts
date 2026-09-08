import type { VirtualItem } from '@tanstack/react-virtual'
import type { RenderRow } from '../listing/render-row'
import { getProjectGroupHeaderPaddingLeft } from '../rows/indentation'

type ProjectGroupFrame = {
  key: string
  color: string
  left: number
  right: number
  startIndex: number
  endIndex: number
  top: number
  height: number
  showTopBoundary: boolean
  showBottomBoundary: boolean
}

type ColoredProjectGroupRange = {
  key: string
  color: string
  depth: number
  startIndex: number
  endIndex: number
}

function getColoredProjectGroupRanges(
  rows: readonly RenderRow[],
  collapsedGroups: ReadonlySet<string>
): ColoredProjectGroupRange[] {
  const ranges: ColoredProjectGroupRange[] = []

  for (let startIndex = 0; startIndex < rows.length; startIndex++) {
    const row = rows[startIndex]
    if (
      row?.type !== 'header' ||
      row.repo ||
      !row.projectGroup ||
      !('color' in row.projectGroup) ||
      typeof row.projectGroup.color !== 'string' ||
      row.projectGroup.color.trim() === '' ||
      collapsedGroups.has(row.key)
    ) {
      continue
    }

    const depth = row.projectGroupDepth ?? 0
    let endIndex = startIndex + 1
    while (endIndex < rows.length) {
      const descendant = rows[endIndex]
      if (descendant?.type === 'host-header') {
        break
      }
      if (descendant?.type === 'header' && (descendant.projectGroupDepth ?? 0) <= depth) {
        break
      }
      endIndex++
    }

    ranges.push({
      key: `${row.hostId ?? ''}:${row.key}`,
      color: row.projectGroup.color.trim(),
      depth,
      startIndex,
      endIndex
    })
  }

  return ranges
}

// Why: use TanStack's already-computed virtual geometry so group frames follow row remeasurement
// and scrolling without introducing DOM reads or a second layout system.
export function getVisibleProjectGroupFrames(args: {
  rows: readonly RenderRow[]
  virtualItems: readonly VirtualItem[]
  collapsedGroups: ReadonlySet<string>
}): ProjectGroupFrame[] {
  const ranges = getColoredProjectGroupRanges(args.rows, args.collapsedGroups)
  const frames: ProjectGroupFrame[] = []

  for (const range of ranges) {
    let first: VirtualItem | undefined
    let last: VirtualItem | undefined
    for (const item of args.virtualItems) {
      if (item.index < range.startIndex) {
        continue
      }
      if (item.index >= range.endIndex) {
        break
      }
      first ??= item
      last = item
    }
    if (!first || !last) {
      continue
    }
    const bottomInset =
      last.index === range.endIndex - 1
        ? ranges.filter(
            (parent) => parent.startIndex < range.startIndex && parent.endIndex === range.endIndex
          ).length * 4
        : 0

    frames.push({
      key: range.key,
      color: range.color,
      // Start just before the compact project-group header anchor; nested frames keep the same tree rhythm.
      left: Math.max(1, getProjectGroupHeaderPaddingLeft(range.depth) - 8),
      right: 4 + range.depth * 4,
      startIndex: range.startIndex,
      endIndex: range.endIndex,
      top: first.start,
      height: Math.max(0, last.end - first.start - bottomInset),
      showTopBoundary: first.index === range.startIndex,
      showBottomBoundary: last.index === range.endIndex - 1
    })
  }

  return frames
}
