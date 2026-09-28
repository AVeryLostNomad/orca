import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Row } from './worktree-list/grouping/row-types'
import {
  getCyclableWorktreeIds,
  getCyclableWorktrees,
  resolveCycledWorktreeId
} from './worktree-keyboard-cycle'

describe('resolveCycledWorktreeId', () => {
  const worktreeIds = ['a', 'b', 'c']

  it('steps to the next and previous worktree', () => {
    expect(resolveCycledWorktreeId({ worktreeIds, activeWorktreeId: 'a', direction: 'down' })).toBe(
      'b'
    )
    expect(resolveCycledWorktreeId({ worktreeIds, activeWorktreeId: 'b', direction: 'up' })).toBe(
      'a'
    )
  })

  it('wraps around at both ends', () => {
    expect(resolveCycledWorktreeId({ worktreeIds, activeWorktreeId: 'c', direction: 'down' })).toBe(
      'a'
    )
    expect(resolveCycledWorktreeId({ worktreeIds, activeWorktreeId: 'a', direction: 'up' })).toBe(
      'c'
    )
  })

  it('enters from the matching end when the active worktree is not cyclable', () => {
    // Why: the active worktree stays selected inside a group the user collapsed,
    // so it is absent from the cyclable list; arrowing should not always jump to
    // the top.
    expect(
      resolveCycledWorktreeId({ worktreeIds, activeWorktreeId: 'hidden', direction: 'down' })
    ).toBe('a')
    expect(
      resolveCycledWorktreeId({ worktreeIds, activeWorktreeId: 'hidden', direction: 'up' })
    ).toBe('c')
    expect(
      resolveCycledWorktreeId({ worktreeIds, activeWorktreeId: null, direction: 'down' })
    ).toBe('a')
  })

  it('has nothing to cycle to when every group is collapsed', () => {
    expect(
      resolveCycledWorktreeId({ worktreeIds: [], activeWorktreeId: 'a', direction: 'down' })
    ).toBe(null)
  })
})

describe('getCyclableWorktreeIds', () => {
  const repo = {
    id: 'repo-1',
    path: '/repo-1',
    displayName: 'Repo 1',
    badgeColor: '#737373',
    addedAt: 1
  }

  function worktree(id: string, isPinned = false): Row & { type: 'item' } {
    return {
      type: 'item',
      rowKey: `row:${id}`,
      sectionKey: isPinned ? 'pinned' : 'repo:repo-1',
      worktree: { id, repoId: repo.id, isPinned } as never,
      repo: repo as never,
      depth: 0,
      groupDepth: 0,
      lineageTrail: [],
      isLastLineageChild: false,
      lineageChildCount: 0
    }
  }

  it('keeps a pinned worktree cyclable when only its natural group is collapsed', () => {
    // Why: `single-location` renders a pinned worktree solely under Pinned, so
    // rebuilding the cycle list from natural groups alone would drop it.
    const rows: Row[] = [worktree('pinned-a', true), worktree('plain-b')]

    expect(getCyclableWorktreeIds(rows, 'single-location')).toEqual(['pinned-a', 'plain-b'])
  })

  it('counts a duplicated pinned worktree once', () => {
    const rows: Row[] = [
      worktree('dup', true),
      { ...worktree('dup'), rowKey: 'row:dup-natural' },
      worktree('plain-b')
    ]

    expect(getCyclableWorktreeIds(rows, 'duplicate-in-groups')).toEqual(['dup', 'plain-b'])
  })

  it('keeps same-id rows on different hosts independently cyclable', () => {
    const rows: Row[] = [
      {
        ...worktree('shared'),
        worktree: { id: 'shared', repoId: repo.id, hostId: 'local' } as never
      },
      {
        ...worktree('shared'),
        rowKey: 'row:shared:ssh',
        worktree: { id: 'shared', repoId: repo.id, hostId: 'ssh:host-b' } as never
      }
    ]

    expect(getCyclableWorktrees(rows, 'single-location').map((item) => item.hostId)).toEqual([
      'local',
      'ssh:host-b'
    ])
  })

  it('leaves folder workspaces out of the rotation', () => {
    // Why: their synthetic `folder:` id is not activatable through
    // activateAndRevealWorktree, so arrowing onto one would be a dead keypress.
    const rows: Row[] = [
      {
        type: 'folder-workspace',
        key: 'folder-workspace:folder-1',
        folderWorkspace: { id: 'folder-1', projectGroupId: 'group-1' } as never,
        projectGroup: { id: 'group-1' } as never,
        depth: 0,
        groupDepth: 0
      },
      worktree('plain-b')
    ]

    expect(getCyclableWorktreeIds(rows, 'single-location')).toEqual(['plain-b'])
  })
})

describe('WorktreeList keyboard cycling', () => {
  it('cycles over the rendered rows instead of rebuilding a parallel layout', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./worktree-list/navigation/use-keyboard.ts', import.meta.url)),
      'utf8'
    )
    const navigateWorktree = source.slice(
      source.indexOf('const navigateWorktree = useCallback('),
      source.indexOf('const handleContainerKeyDown = useCallback(')
    )

    // Why: a second buildRows call drifts from the rendered layout (host sections,
    // pinned placement); cycling must read the same rows the viewport renders.
    expect(navigateWorktree).toContain('getCyclableWorktreeRows(rows, pinnedDisplayPolicy)')
    expect(navigateWorktree).toContain('getCyclableRowIdentity')
    // Why: the active host is stored resolved while a local row is unqualified; comparing raw identities wraps to the top.
    expect(navigateWorktree).toContain('resolveActiveCycleIdentity')
    expect(navigateWorktree).not.toContain('composeWorktreeHostIdentity')
    expect(navigateWorktree).toContain('executionHostId: nextWorktree.hostId')
    expect(navigateWorktree).toContain('resolveCycledWorktreeId')
    expect(navigateWorktree).not.toContain('buildRows(')
  })
})
