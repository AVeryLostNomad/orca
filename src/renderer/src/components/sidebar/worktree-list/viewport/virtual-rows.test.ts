import { describe, expect, it } from 'vitest'
import type { VirtualItem } from '@tanstack/react-virtual'
import {
  buildLineageRowRekeyMap,
  extractWorktreeVirtualRowIndexes,
  getActiveWorktreeStickyHeaderIndex,
  getStickyHeaderIndexes,
  pruneStaleVirtualRowElementCache
} from './virtual-rows'
import { getRenderRowKey } from '../listing/render-row'
import type { RenderRow } from '../listing/render-row'

function groupRow(key: string): RenderRow {
  return { type: 'header', key, label: key, count: 1, tone: 'text-foreground' }
}

function itemStub(id: string): RenderRow {
  return { type: 'item', key: id } as unknown as RenderRow
}

function virtualItem(index: number, start: number): VirtualItem {
  return { index, start } as VirtualItem
}

// rows: [group-1, item, group-2, item, group-3, item]; each row 100px tall.
const rows: RenderRow[] = [
  groupRow('g1'),
  itemStub('wt-1'),
  groupRow('g2'),
  itemStub('wt-2'),
  groupRow('g3'),
  itemStub('wt-3')
]
const stickyHeaderIndexes = getStickyHeaderIndexes(rows)
const virtualItems = rows.map((_, index) => virtualItem(index, index * 100))

describe('getRenderRowKey', () => {
  it('keys group headers by their group key', () => {
    expect(getRenderRowKey(groupRow('workspace-status:in-progress'))).toBe(
      'hdr:workspace-status:in-progress'
    )
  })
})

describe('getActiveWorktreeStickyHeaderIndex', () => {
  it('pins the group whose section is scrolled under the top edge', () => {
    expect(
      getActiveWorktreeStickyHeaderIndex({
        rangeStartIndex: 1,
        scrollOffset: 150,
        stickyHeaderIndexes,
        virtualItems
      })
    ).toBe(0)
  })

  it('hands off the moment the next header reaches the top', () => {
    const at = (scrollOffset: number): number | null =>
      getActiveWorktreeStickyHeaderIndex({
        rangeStartIndex: 2,
        scrollOffset,
        stickyHeaderIndexes,
        virtualItems
      })
    expect(at(199)).toBe(0)
    expect(at(200)).toBe(2)
  })

  it('keeps the previous mounted header while the next one is not mounted yet (#10088)', () => {
    // Why: scrollToIndex/reveal can advance rangeStart before TanStack mounts the header row.
    const partialItems = [virtualItem(0, 0), virtualItem(1, 100), virtualItem(3, 300)]
    expect(
      getActiveWorktreeStickyHeaderIndex({
        rangeStartIndex: 2,
        scrollOffset: 250,
        stickyHeaderIndexes,
        virtualItems: partialItems
      })
    ).toBe(0)
  })
})

describe('extractWorktreeVirtualRowIndexes', () => {
  it('keeps the pinned header and its predecessor mounted when scrolled out of range', () => {
    const indexes = extractWorktreeVirtualRowIndexes({
      range: {
        startIndex: 5,
        endIndex: 5,
        overscan: 0,
        count: rows.length,
        getItemIndex: (i: number) => i
      } as never,
      stickyHeaderIndexes
    })
    expect(indexes).toEqual([2, 4, 5])
  })
})

describe('buildLineageRowRekeyMap', () => {
  // Mirrors buildWorktreeRow: rowKey is `${sectionKey}:${worktree.id}`.
  function worktreeRow(sectionKey: string, worktreeId: string): RenderRow {
    return {
      type: 'item',
      rowKey: `${sectionKey}:${worktreeId}`,
      sectionKey,
      worktree: { id: worktreeId },
      depth: 0,
      groupDepth: 0,
      lineageTrail: [],
      isLastLineageChild: true,
      lineageChildCount: 0
    } as unknown as RenderRow
  }

  function lineageGroupRow(sectionKey: string, parentId: string, childIds: string[]): RenderRow {
    return {
      type: 'lineage-group',
      key: `${sectionKey}:lineage:${parentId}`,
      rows: [parentId, ...childIds].map(
        (id) => worktreeRow(sectionKey, id) as Extract<RenderRow, { type: 'item' }>
      )
    }
  }

  it('folds every lineage-group member onto the group key', () => {
    const group = lineageGroupRow('all', 'p', ['c1', 'c2'])
    const rekeys = buildLineageRowRekeyMap([group])

    // The parent's own row key is what an anchor recorded before the child
    // existed; all members now live inside the single group row.
    expect(rekeys.get('wt:all:p')).toBe('lineage-group:all:lineage:p')
    expect(rekeys.get('wt:all:c1')).toBe('lineage-group:all:lineage:p')
    expect(rekeys.get('wt:all:c2')).toBe('lineage-group:all:lineage:p')
    expect(getRenderRowKey(group)).toBe('lineage-group:all:lineage:p')
  })

  it('dissolves a group key back onto the plain item row', () => {
    // Last child deleted: lineageChildCount is already 0, but an anchor still
    // holds the group key, so the reverse mapping must be unguarded.
    const rekeys = buildLineageRowRekeyMap([worktreeRow('all', 'p')])

    expect(rekeys.get('lineage-group:all:lineage:p')).toBe('wt:all:p')
  })

  it('round-trips the fold and dissolve directions for the same worktree', () => {
    const folded = buildLineageRowRekeyMap([lineageGroupRow('all', 'p', ['c1'])])
    const dissolved = buildLineageRowRekeyMap([worktreeRow('all', 'p')])

    expect(dissolved.get(folded.get('wt:all:p') as string)).toBe('wt:all:p')
  })

  it('keeps the same worktree distinct across sections', () => {
    // The same worktree renders in both Pinned and All; rowKey embeds the
    // section so a pinned anchor must never follow the All copy.
    const rekeys = buildLineageRowRekeyMap([
      lineageGroupRow('pinned', 'p', ['c1']),
      lineageGroupRow('all', 'p', ['c1'])
    ])

    expect(rekeys.get('wt:pinned:p')).toBe('lineage-group:pinned:lineage:p')
    expect(rekeys.get('wt:all:p')).toBe('lineage-group:all:lineage:p')
    expect(rekeys.get('wt:pinned:c1')).toBe('lineage-group:pinned:lineage:p')
    expect(rekeys.get('wt:all:c1')).toBe('lineage-group:all:lineage:p')

    const dissolvedRekeys = buildLineageRowRekeyMap([
      worktreeRow('pinned', 'p'),
      worktreeRow('all', 'p')
    ])
    expect(dissolvedRekeys.get('lineage-group:pinned:lineage:p')).toBe('wt:pinned:p')
    expect(dissolvedRekeys.get('lineage-group:all:lineage:p')).toBe('wt:all:p')
  })

  it('contributes nothing for non-lineage row types', () => {
    expect(buildLineageRowRekeyMap([groupRow('a1'), groupRow('b1')]).size).toBe(0)
  })

  it('is empty for an empty row list', () => {
    expect(buildLineageRowRekeyMap([]).size).toBe(0)
  })
})

describe('pruneStaleVirtualRowElementCache', () => {
  it('removes stale measured row elements before they retain old WorktreeCard scopes', () => {
    const activeElement = {
      isConnected: true,
      getAttribute: (name: string) =>
        name === 'data-worktree-virtual-row-key' ? 'wt:active' : null
    } as Element
    const staleElement = {
      isConnected: false,
      getAttribute: (name: string) => (name === 'data-worktree-virtual-row-key' ? 'wt:stale' : null)
    } as Element
    const connectedStaleElement = {
      isConnected: true,
      getAttribute: (name: string) =>
        name === 'data-worktree-virtual-row-key' ? 'wt:connected-stale' : null
    } as Element
    const retainedScope = {
      defaultHostId: 'runtime:env-1',
      handlerName: 'handleOpenReviewInOrca'
    }
    Object.assign(staleElement, { __retainedWorktreeCardScopeForTest: retainedScope })

    const virtualizer = {
      elementsCache: new Map<string, Element>([
        ['wt:active', activeElement],
        ['wt:stale', staleElement],
        ['wt:connected-stale', connectedStaleElement]
      ]),
      measureElement: (element: Element | null) => {
        if (element) {
          throw new Error('stale cache pruning should not remeasure rows')
        }
      }
    }

    pruneStaleVirtualRowElementCache({
      activeRowKeys: new Set(['wt:active']),
      virtualizer
    })

    expect(virtualizer.elementsCache.get('wt:active')).toBe(activeElement)
    expect(virtualizer.elementsCache.has('wt:stale')).toBe(false)
    expect(virtualizer.elementsCache.get('wt:connected-stale')).toBe(connectedStaleElement)
  })
})
