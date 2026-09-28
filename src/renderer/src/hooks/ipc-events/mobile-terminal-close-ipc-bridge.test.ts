// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = {
  setActiveWorktree: vi.fn(),
  markWorktreeVisited: vi.fn(),
  setActiveView: vi.fn(),
  openFile: vi.fn(),
  openDiff: vi.fn(),
  setActiveTabType: vi.fn(),
  revealWorktreeInSidebar: vi.fn()
}

vi.mock('@/store', () => ({ useAppStore: { getState: () => store } }))
vi.mock('@/lib/language-detect', () => ({ detectLanguage: () => 'typescript' }))
vi.mock('@/components/terminal/terminal-tab-actions', () => ({ closeTerminalTab: vi.fn() }))
vi.mock('@/components/sidebar/sleep-worktree-flow', () => ({ runSleepWorktree: vi.fn() }))
vi.mock('@/lib/workspace-session', () => ({ buildWorkspaceSessionPayload: vi.fn() }))
vi.mock('@/lib/workspace-session-host-persistence', () => ({
  persistWorkspaceSessionByHost: vi.fn()
}))

import { registerMobileAndTerminalCloseIpcBridge } from './mobile-terminal-close-ipc-bridge'

type FileOpenListener = (data: {
  worktreeId: string
  filePath: string
  relativePath: string
  runtimeEnvironmentId?: string
  activate?: boolean
}) => void

function registerBridge(): FileOpenListener {
  let onOpenFile: FileOpenListener | undefined
  window.api = {
    ui: {
      onOpenFileFromMobile: (listener: FileOpenListener) => {
        onOpenFile = listener
        return () => {}
      },
      onOpenDiffFromMobile: () => () => {},
      onCloseTerminal: () => () => {},
      onSleepWorktree: () => () => {},
      onResumeSleepingAgents: () => () => {}
    }
  } as unknown as typeof window.api
  registerMobileAndTerminalCloseIpcBridge([], vi.fn())
  if (!onOpenFile) {
    throw new Error('missing file listener')
  }
  return onOpenFile
}

describe('mobile file open IPC', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opens activate:false files without changing the host selection', () => {
    const onOpenFile = registerBridge()
    onOpenFile({
      worktreeId: 'other-worktree',
      filePath: '/repo/src/app.ts',
      relativePath: 'src/app.ts',
      activate: false
    })

    expect(store.openFile).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: 'other-worktree', mode: 'edit' }),
      { background: true }
    )
    expect(store.setActiveWorktree).not.toHaveBeenCalled()
    expect(store.setActiveView).not.toHaveBeenCalled()
    expect(store.setActiveTabType).not.toHaveBeenCalled()
    expect(store.revealWorktreeInSidebar).not.toHaveBeenCalled()
  })

  it('keeps existing activation behavior when activate is absent', () => {
    const onOpenFile = registerBridge()
    onOpenFile({
      worktreeId: 'other-worktree',
      filePath: '/repo/src/app.ts',
      relativePath: 'src/app.ts'
    })

    expect(store.openFile).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: 'other-worktree', mode: 'edit' }),
      { background: false }
    )
    expect(store.setActiveWorktree).toHaveBeenCalledWith('other-worktree')
    expect(store.setActiveView).toHaveBeenCalledWith('terminal')
    expect(store.setActiveTabType).toHaveBeenCalledWith('editor')
    expect(store.revealWorktreeInSidebar).toHaveBeenCalledWith('other-worktree')
  })
})
