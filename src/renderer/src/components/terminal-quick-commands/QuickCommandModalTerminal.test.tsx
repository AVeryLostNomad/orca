// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  state: {
    quickCommandModal: {
      requestId: 'popup-1',
      worktreeId: 'workspace-1',
      cwd: '/repo/workspace-1'
    } as {
      requestId: string
      worktreeId: string
      cwd: string | null
      command?: {
        id: string
        label: string
        action: 'terminal-command'
        command: string
        appendEnter: boolean
        mode: 'modal'
      }
    } | null,
    closeQuickCommandModal: vi.fn(),
    createTab: vi.fn(() => ({ id: 'popup-tab-1' })),
    closeTab: vi.fn(),
    setActiveTabForWorktree: vi.fn(),
    setTabCustomTitle: vi.fn(),
    queueTabStartupCommand: vi.fn()
  }
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state)
}))
vi.mock('@/components/terminal-pane/TerminalPane', () => ({
  default: () => <div className="xterm" data-testid="terminal-pane" tabIndex={0} />
}))

import { QuickCommandModalTerminal } from './QuickCommandModalTerminal'

afterEach(cleanup)

beforeEach(() => {
  mocks.state.quickCommandModal = {
    requestId: 'popup-1',
    worktreeId: 'workspace-1',
    cwd: '/repo/workspace-1'
  }
  for (const value of Object.values(mocks.state)) {
    if (typeof value === 'function' && 'mockClear' in value) {
      value.mockClear()
    }
  }
})

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

  it('dismisses the interactive popup from its X button or Escape in xterm', () => {
    const view = render(<QuickCommandModalTerminal />)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(mocks.state.closeQuickCommandModal).toHaveBeenCalledOnce()

    mocks.state.closeQuickCommandModal.mockClear()
    view.unmount()
    render(<QuickCommandModalTerminal />)
    fireEvent.keyDown(screen.getByTestId('terminal-pane'), { key: 'Escape', code: 'Escape' })
    expect(mocks.state.closeQuickCommandModal).toHaveBeenCalledOnce()
  })
})
