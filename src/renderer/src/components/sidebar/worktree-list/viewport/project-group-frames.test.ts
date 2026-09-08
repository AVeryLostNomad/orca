import { describe, expect, it } from 'vitest'
import type { VirtualItem } from '@tanstack/react-virtual'
import type { RenderRow } from '../listing/render-row'
import { getVisibleProjectGroupFrames } from './project-group-frames'

function header(key: string, depth: number, color?: string): RenderRow {
  return {
    type: 'header',
    key,
    label: key,
    count: 1,
    tone: '',
    projectGroupDepth: depth,
    ...(color ? { projectGroup: { id: key, name: key, tabOrder: 0, color } } : {})
  } as RenderRow
}

function geometry(rows: RenderRow[], indexes = rows.map((_, index) => index)) {
  return getVisibleProjectGroupFrames({
    rows,
    collapsedGroups: new Set(),
    virtualItems: indexes.map(
      (index) =>
        ({
          key: index,
          index,
          start: index * 40,
          end: (index + 1) * 40,
          size: 40,
          lane: 0
        }) satisfies VirtualItem
    )
  })
}

describe('project group frame containment', () => {
  it('ends before a same-depth repository header without project group metadata', () => {
    const frames = geometry([
      header('group', 0, 'purple'),
      header('child-repo', 1),
      header('outside-repo', 0)
    ])
    expect(frames[0].top + frames[0].height).toBe(80)
    expect(frames[0].showBottomBoundary).toBe(true)
  })

  it('insets nested frames on both sides and ends each at its own sibling', () => {
    const frames = geometry([
      header('parent', 0, 'purple'),
      header('nested', 1, 'green'),
      header('nested-repo', 2),
      header('parent-repo', 1),
      header('outside', 0)
    ])
    expect(frames[1].left).toBeGreaterThan(frames[0].left)
    expect(frames[1].right).toBeGreaterThan(frames[0].right)
    expect(frames[1].top + frames[1].height).toBe(120)
    expect(frames[0].top + frames[0].height).toBe(160)
  })

  it('does not close a clipped frame at a virtual viewport boundary', () => {
    const frames = geometry(
      [
        header('parent', 0, 'purple'),
        header('repo-a', 1),
        header('repo-b', 1),
        header('outside', 0)
      ],
      [1]
    )
    expect(frames[0].showTopBoundary).toBe(false)
    expect(frames[0].showBottomBoundary).toBe(false)
  })
})
