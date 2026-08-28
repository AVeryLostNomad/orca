import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createBrowserUuid: vi.fn(() => 'popup-1'),
  state: {
    activeWorktreeId: 'workspace-1' as string | null,
    quickCommandModal: null as null | {
      command?: { id: string }
      requestId: string
      worktreeId: string
      cwd: string | null
    },
    closeQuickCommandModal: vi.fn(),
    getKnownWorktreeById: vi.fn(() => ({ path: '/repo/workspace-1' })),
    openQuickCommandModal: vi.fn()
  }
}))

vi.mock('@/lib/browser-uuid', () => ({ createBrowserUuid: mocks.createBrowserUuid }))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => mocks.state }
}))

import { openPopupTerminal, togglePopupTerminal } from './open-popup-terminal'

describe('openPopupTerminal', () => {
  beforeEach(() => {
    mocks.state.activeWorktreeId = 'workspace-1'
    mocks.state.quickCommandModal = null
    mocks.state.closeQuickCommandModal.mockClear()
    mocks.state.getKnownWorktreeById.mockClear()
    mocks.state.openQuickCommandModal.mockClear()
  })

  it('opens an interactive popup rooted in the active workspace', () => {
    expect(openPopupTerminal()).toBe(true)
    expect(mocks.state.openQuickCommandModal).toHaveBeenCalledWith({
      requestId: 'popup-1',
      worktreeId: 'workspace-1',
      cwd: '/repo/workspace-1'
    })
  })

  it('does nothing without a current workspace', () => {
    mocks.state.activeWorktreeId = null

    expect(openPopupTerminal()).toBe(false)
    expect(mocks.state.openQuickCommandModal).not.toHaveBeenCalled()
  })

  it('closes an existing interactive popup when toggled again', () => {
    mocks.state.quickCommandModal = {
      requestId: 'popup-1',
      worktreeId: 'workspace-1',
      cwd: '/repo/workspace-1'
    }

    expect(togglePopupTerminal()).toBe(true)
    expect(mocks.state.closeQuickCommandModal).toHaveBeenCalledOnce()
    expect(mocks.state.openQuickCommandModal).not.toHaveBeenCalled()
  })

  it('does not replace a command-owned popup', () => {
    mocks.state.quickCommandModal = {
      requestId: 'command-1',
      worktreeId: 'workspace-1',
      cwd: '/repo/workspace-1',
      command: { id: 'build' }
    }

    expect(togglePopupTerminal()).toBe(false)
    expect(mocks.state.closeQuickCommandModal).not.toHaveBeenCalled()
    expect(mocks.state.openQuickCommandModal).not.toHaveBeenCalled()
  })
})
