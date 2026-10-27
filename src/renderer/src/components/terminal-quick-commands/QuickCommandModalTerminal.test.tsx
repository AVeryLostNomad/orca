// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

type MockPaneProps = {
  onPtyExit?: (ptyId: string, exitCode?: number) => void
  onProcessFailed?: (exitCode: number) => void
}

const BUILD_COMMAND = {
  id: 'cmd-1',
  label: 'Build',
  action: 'terminal-command' as const,
  command: 'pnpm build',
  appendEnter: true,
  mode: 'modal' as const
}

const mocks = vi.hoisted(() => ({
  state: {
    quickCommandModal: null as {
      requestId: string
      worktreeId: string
      cwd: string | null
      startupCommand?: string
      command?: {
        id: string
        label: string
        action: 'terminal-command'
        command: string
        appendEnter: boolean
        mode: 'modal'
      }
    } | null,
    ptyIdsByTabId: {} as Record<string, string[]>,
    settings: null,
    closeQuickCommandModal: vi.fn(),
    createTab: vi.fn(() => ({ id: 'popup-tab-1' })),
    closeTab: vi.fn(),
    setActiveTabForWorktree: vi.fn(),
    setTabCustomTitle: vi.fn(),
    queueTabStartupCommand: vi.fn()
  },
  paneProps: null as MockPaneProps | null,
  inputState: { ptyId: 'pty-1' as string | null, isAlternateScreen: false },
  probePtyRunningWork: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
    { getState: () => mocks.state }
  )
}))
vi.mock('@/components/terminal/pty-running-work-probe', () => ({
  probePtyRunningWork: mocks.probePtyRunningWork
}))
vi.mock('@/components/terminal-pane/terminal-pane-active-input-state', () => ({
  readTerminalPaneActiveInputState: () => mocks.inputState
}))
vi.mock('@/components/terminal-pane/TerminalPane', () => ({
  default: function MockTerminalPane(props: MockPaneProps) {
    mocks.paneProps = props
    return <div className="xterm" data-testid="terminal-pane" tabIndex={0} />
  }
}))

import { QuickCommandModalTerminal } from './QuickCommandModalTerminal'

afterEach(cleanup)

beforeEach(() => {
  mocks.state.quickCommandModal = {
    requestId: 'popup-1',
    worktreeId: 'workspace-1',
    cwd: '/repo/workspace-1'
  }
  mocks.state.ptyIdsByTabId = {}
  mocks.inputState = { ptyId: 'pty-1', isAlternateScreen: false }
  mocks.probePtyRunningWork.mockReset()
  for (const value of Object.values(mocks.state)) {
    if (typeof value === 'function' && 'mockClear' in value) {
      value.mockClear()
    }
  }
})

function openBuildTask(): void {
  mocks.state.quickCommandModal = {
    requestId: 'popup-1',
    worktreeId: 'workspace-1',
    cwd: '/repo/workspace-1',
    command: BUILD_COMMAND,
    startupCommand: 'pnpm build; exit'
  }
}

function pressEscapeInTerminal(): void {
  fireEvent.keyDown(screen.getByTestId('terminal-pane'), { key: 'Escape', code: 'Escape' })
}

describe('QuickCommandModalTerminal', () => {
  it('opens a blank terminal without creating a workspace tab or startup command', () => {
    render(<QuickCommandModalTerminal />)

    expect(screen.getByText('Popup Terminal')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-pane')).toBeInTheDocument()
    expect(mocks.state.createTab).toHaveBeenCalledWith(
      'workspace-1::workspace:popup-1',
      undefined,
      undefined,
      { activate: false, recordInteraction: false }
    )
    expect(mocks.state.queueTabStartupCommand).not.toHaveBeenCalled()
  })

  it('dismisses the popup from its X button', () => {
    render(<QuickCommandModalTerminal />)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(mocks.state.closeQuickCommandModal).toHaveBeenCalledOnce()
  })

  it('closes on Escape in xterm once the shell has no foreground program', async () => {
    mocks.probePtyRunningWork.mockResolvedValue([{ ptyId: 'pty-1', verdict: 'exited' }])
    render(<QuickCommandModalTerminal />)

    pressEscapeInTerminal()

    await waitFor(() => expect(mocks.state.closeQuickCommandModal).toHaveBeenCalledOnce())
    expect(mocks.probePtyRunningWork).toHaveBeenCalledWith(['pty-1'], expect.any(Object))
  })

  it.each(['live', 'unverifiable'])('keeps Escape for a %s foreground program', async (verdict) => {
    mocks.probePtyRunningWork.mockResolvedValue([{ ptyId: 'pty-1', verdict }])
    render(<QuickCommandModalTerminal />)

    pressEscapeInTerminal()

    await waitFor(() => expect(mocks.probePtyRunningWork).toHaveBeenCalledOnce())
    await Promise.resolve()
    expect(mocks.state.closeQuickCommandModal).not.toHaveBeenCalled()
  })

  it('keeps Escape for a full-screen TUI without probing', () => {
    mocks.inputState = { ptyId: 'pty-1', isAlternateScreen: true }
    render(<QuickCommandModalTerminal />)

    pressEscapeInTerminal()

    expect(mocks.probePtyRunningWork).not.toHaveBeenCalled()
    expect(mocks.state.closeQuickCommandModal).not.toHaveBeenCalled()
  })

  it('does not close a newer popup when a stale Escape probe resolves', async () => {
    let resolveProbe: (value: unknown) => void = () => {}
    mocks.probePtyRunningWork.mockReturnValue(new Promise((resolve) => (resolveProbe = resolve)))
    render(<QuickCommandModalTerminal />)

    pressEscapeInTerminal()
    mocks.state.quickCommandModal = { requestId: 'popup-2', worktreeId: 'workspace-1', cwd: null }
    resolveProbe([{ ptyId: 'pty-1', verdict: 'exited' }])
    await Promise.resolve()

    expect(mocks.state.closeQuickCommandModal).not.toHaveBeenCalled()
  })

  it('runs a task with its exit-terminated startup command', () => {
    openBuildTask()
    render(<QuickCommandModalTerminal />)

    expect(mocks.state.queueTabStartupCommand).toHaveBeenCalledWith('popup-tab-1', {
      command: 'pnpm build; exit'
    })
  })

  it('waits for any key after a task exits, keeping its output mounted', () => {
    openBuildTask()
    mocks.state.ptyIdsByTabId = { 'popup-tab-1': ['pty-1'] }
    const view = render(<QuickCommandModalTerminal />)
    expect(screen.queryByText('Task finished. Press any key to close.')).not.toBeInTheDocument()

    mocks.state.ptyIdsByTabId = { 'popup-tab-1': [] }
    view.rerender(<QuickCommandModalTerminal />)

    expect(screen.getByText('Task finished. Press any key to close.')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-pane')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Shift' })
    fireEvent.keyDown(window, { key: 'c', metaKey: true })
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
    expect(mocks.state.closeQuickCommandModal).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'q' })
    expect(mocks.state.closeQuickCommandModal).toHaveBeenCalledOnce()
  })

  it('reports a failed task exit in place of the pane overlay', () => {
    openBuildTask()
    render(<QuickCommandModalTerminal />)

    act(() => mocks.paneProps?.onProcessFailed?.(2))

    expect(screen.getByText('Exited with code 2.')).toBeInTheDocument()
    expect(screen.getByText('Task finished. Press any key to close.')).toBeInTheDocument()
    expect(mocks.state.closeQuickCommandModal).not.toHaveBeenCalled()
  })

  it('closes on Escape after a task finishes without probing', () => {
    openBuildTask()
    render(<QuickCommandModalTerminal />)
    act(() => mocks.paneProps?.onPtyExit?.('pty-1', 0))

    pressEscapeInTerminal()

    expect(mocks.probePtyRunningWork).not.toHaveBeenCalled()
    expect(mocks.state.closeQuickCommandModal).toHaveBeenCalled()
  })

  it('closes the interactive popup when its shell exits', () => {
    render(<QuickCommandModalTerminal />)

    act(() => mocks.paneProps?.onPtyExit?.('pty-1', 0))

    expect(mocks.state.closeQuickCommandModal).toHaveBeenCalledOnce()
    expect(mocks.paneProps?.onProcessFailed).toBeUndefined()
  })
})
