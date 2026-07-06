import { describe, expect, it } from 'vitest'
import { createTestStore, makeWorktree } from './store-test-helpers'

describe('code-server slice', () => {
  it('creates one tab per worktree and focuses the existing one on repeat', () => {
    const store = createTestStore()
    const wt = makeWorktree({ id: 'wt-1', repoId: 'repo' })
    store.setState({ worktreesByRepo: { repo: [wt] } } as never)

    const first = store.getState().createCodeServerTab('wt-1', '/repo/wt-1', 'wt-1')
    const second = store.getState().createCodeServerTab('wt-1', '/repo/wt-1', 'wt-1')

    expect(second.id).toBe(first.id) // reopen focuses, does not duplicate
    expect(store.getState().codeServerTabsByWorktree['wt-1']).toHaveLength(1)
    expect(store.getState().activeCodeServerTabIdByWorktree['wt-1']).toBe(first.id)
  })

  it('closes a tab and clears the active id', () => {
    const store = createTestStore()
    const tab = store.getState().createCodeServerTab('wt-1', '/repo/wt-1', 'wt-1')
    store.getState().closeCodeServerTab(tab.id)
    expect(store.getState().codeServerTabsByWorktree['wt-1'] ?? []).toHaveLength(0)
    expect(store.getState().activeCodeServerTabIdByWorktree['wt-1']).toBeNull()
  })

  it('mirrors server status', () => {
    const store = createTestStore()
    store.getState().setCodeServerStatus({ status: 'ready', port: 8080 })
    expect(store.getState().codeServerStatus).toBe('ready')
    expect(store.getState().codeServerPort).toBe(8080)
  })
})
