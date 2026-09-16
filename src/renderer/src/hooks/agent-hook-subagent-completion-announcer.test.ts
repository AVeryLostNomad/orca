import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParsedAgentStatusPayload } from '../../../shared/agent-status-types'

const dispatchTerminalNotification = vi.fn()

type MockStoreState = {
  settings: {
    experimentalTerminalAttention?: boolean
    notifications: { enabled: boolean; agentTaskComplete: boolean; subagentTaskComplete?: boolean }
  }
  ptyIdsByTabId: Record<string, string[]>
  suppressedPtyExitIds: Record<string, boolean>
  tabsByWorktree: Record<string, { id: string; ptyId?: string | null }[]>
  terminalLayoutsByTabId: Record<string, unknown>
  agentLaunchConfigByPaneKey: Record<string, unknown>
  agentStatusByPaneKey: Record<string, unknown>
  getAgentLaunchConfigForStatusEntry: () => undefined
  getAgentLaunchConfigForStatusMetadata: () => undefined
}

let mockStoreState: MockStoreState

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => mockStoreState
  }
}))

vi.mock('@/components/terminal-pane/use-notification-dispatch', () => ({
  dispatchTerminalNotification
}))

vi.mock('@/components/terminal-pane/agent-hook-terminal-lifecycle', () => ({
  dispatchAgentHookTerminalLifecycle: vi.fn()
}))

const paneKey = 'tab-1:11111111-1111-4111-8111-111111111111'

function leadWorking(): ParsedAgentStatusPayload {
  return { state: 'working', prompt: 'review the diff', agentType: 'omp' }
}

function finishedChild(completedAt = 1_700_000_000_000): ParsedAgentStatusPayload {
  return {
    ...leadWorking(),
    subagentCompletedAt: completedAt,
    subagentCompletedLabel: 'Reviewer'
  }
}

describe('subagent completion announcements', () => {
  beforeEach(() => {
    vi.resetModules()
    dispatchTerminalNotification.mockClear()
    mockStoreState = {
      settings: {
        experimentalTerminalAttention: false,
        notifications: { enabled: true, agentTaskComplete: true, subagentTaskComplete: true }
      },
      ptyIdsByTabId: { 'tab-1': ['pty-1'] },
      suppressedPtyExitIds: {},
      tabsByWorktree: { 'wt-1': [{ id: 'tab-1', ptyId: 'pty-1' }] },
      terminalLayoutsByTabId: {},
      agentLaunchConfigByPaneKey: {},
      agentStatusByPaneKey: {},
      getAgentLaunchConfigForStatusEntry: () => undefined,
      getAgentLaunchConfigForStatusMetadata: () => undefined
    }
  })

  it('announces a stamped finish once even when the same row is re-emitted', async () => {
    const { announceSubagentCompletion } =
      await import('./agent-hook-subagent-completion-announcer')

    announceSubagentCompletion(paneKey, 'wt-1', leadWorking())
    announceSubagentCompletion(paneKey, 'wt-1', finishedChild())
    // Why: relay replays and roster refreshes repeat the same stamp.
    announceSubagentCompletion(paneKey, 'wt-1', finishedChild())
    announceSubagentCompletion(paneKey, 'wt-1', finishedChild(1_700_000_000_500))

    expect(dispatchTerminalNotification).toHaveBeenCalledTimes(2)
    expect(dispatchTerminalNotification).toHaveBeenCalledWith('wt-1', {
      source: 'subagent-task-complete',
      paneKey,
      agentStatusSnapshot: finishedChild()
    })
  })

  it('stays silent by default and still remembers the stamp', async () => {
    mockStoreState.settings.notifications.subagentTaskComplete = false
    const { announceSubagentCompletion } =
      await import('./agent-hook-subagent-completion-announcer')

    announceSubagentCompletion(paneKey, 'wt-1', finishedChild())
    mockStoreState.settings.notifications.subagentTaskComplete = true
    announceSubagentCompletion(paneKey, 'wt-1', finishedChild())

    expect(dispatchTerminalNotification).not.toHaveBeenCalled()
  })

  it('forgetting a pane lets a re-created pane announce the same stamp again', async () => {
    const { announceSubagentCompletion, forgetSubagentCompletionAnnouncements } =
      await import('./agent-hook-subagent-completion-announcer')

    announceSubagentCompletion(paneKey, 'wt-1', finishedChild())
    forgetSubagentCompletionAnnouncements(paneKey)
    announceSubagentCompletion(paneKey, 'wt-1', finishedChild())

    expect(dispatchTerminalNotification).toHaveBeenCalledTimes(2)
  })

  it('runs from live hook observation but not from replay seeds', async () => {
    const { observeAgentHookCompletionForNotification } =
      await import('./agent-hook-completion-notifications')

    observeAgentHookCompletionForNotification({
      paneKey,
      worktreeId: 'wt-1',
      payload: finishedChild(),
      seedOnly: true
    })
    expect(dispatchTerminalNotification).not.toHaveBeenCalled()

    observeAgentHookCompletionForNotification({
      paneKey,
      worktreeId: 'wt-1',
      payload: finishedChild()
    })
    expect(dispatchTerminalNotification).toHaveBeenCalledWith(
      'wt-1',
      expect.objectContaining({ source: 'subagent-task-complete', paneKey })
    )
  })
})
