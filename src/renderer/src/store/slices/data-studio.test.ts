import { describe, expect, it } from 'vitest'
import { createTestStore, makeWorktree } from './store-test-helpers'

describe('data-studio slice', () => {
  it('creates one tab per worktree and focuses the existing one on repeat', () => {
    const store = createTestStore()
    const wt = makeWorktree({ id: 'wt-1', repoId: 'repo' })
    store.setState({ worktreesByRepo: { repo: [wt] } } as never)

    const first = store.getState().createDataStudioTab('wt-1', 'repo', '/repo/wt-1', 'Data Studio')
    const second = store.getState().createDataStudioTab('wt-1', 'repo', '/repo/wt-1', 'Data Studio')

    expect(second.id).toBe(first.id) // reopen focuses, does not duplicate
    expect(first.repoId).toBe('repo')
    expect(store.getState().dataStudioTabsByWorktree['wt-1']).toHaveLength(1)
    expect(store.getState().activeDataStudioTabIdByWorktree['wt-1']).toBe(first.id)
  })

  it('allows one tab per worktree across sibling worktrees of the same repo', () => {
    const store = createTestStore()
    const a = store.getState().createDataStudioTab('wt-a', 'repo', '/repo/wt-a', 'Data Studio')
    const b = store.getState().createDataStudioTab('wt-b', 'repo', '/repo/wt-b', 'Data Studio')
    expect(a.id).not.toBe(b.id)
    expect(store.getState().dataStudioTabsByWorktree['wt-a']).toHaveLength(1)
    expect(store.getState().dataStudioTabsByWorktree['wt-b']).toHaveLength(1)
  })

  it('closes a tab and clears the active id', () => {
    const store = createTestStore()
    const tab = store.getState().createDataStudioTab('wt-1', 'repo', '/repo/wt-1', 'Data Studio')
    store.getState().closeDataStudioTab(tab.id)
    expect(store.getState().dataStudioTabsByWorktree['wt-1'] ?? []).toHaveLength(0)
    expect(store.getState().activeDataStudioTabIdByWorktree['wt-1']).toBeNull()
  })

  it('routes server status per repo', () => {
    const store = createTestStore()
    store.getState().setDataStudioStatus({ repoId: 'repo-a', status: 'ready', port: 41100 })
    store.getState().setDataStudioStatus({ repoId: 'repo-b', status: 'starting', port: null })
    expect(store.getState().dataStudioStatusByRepo['repo-a']).toEqual({
      repoId: 'repo-a',
      status: 'ready',
      port: 41100
    })
    expect(store.getState().dataStudioStatusByRepo['repo-b']?.status).toBe('starting')
  })

  it('hydrates persisted tabs and backfills unified tabs', () => {
    const store = createTestStore()
    store.getState().hydrateDataStudioSession({
      dataStudioTabsByWorktree: {
        'wt-1': [
          {
            id: 'ds-1',
            worktreeId: 'wt-1',
            repoId: 'repo',
            folderPath: '/repo/wt-1',
            label: 'Data Studio'
          }
        ]
      },
      activeDataStudioTabIdByWorktree: { 'wt-1': 'ds-1' }
    } as never)
    const unified = store.getState().unifiedTabsByWorktree['wt-1'] ?? []
    expect(unified.some((tab) => tab.contentType === 'datastudio' && tab.entityId === 'ds-1')).toBe(
      true
    )
  })
})
