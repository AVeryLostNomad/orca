import { afterEach, describe, expect, it, vi } from 'vitest'

const { activateStructuredAgentSessionTabMock } = vi.hoisted(() => ({
  activateStructuredAgentSessionTabMock: vi.fn(() => true)
}))

vi.mock('@/lib/structured-agent-session-tab-activation', () => ({
  activateStructuredAgentSessionTab: activateStructuredAgentSessionTabMock
}))

import { useAppStore } from '@/store'
import type { Tab, TabGroup } from '../../../shared/tab-types'
import { activateTabNumberShortcut } from './tab-number-shortcuts'

const WORKTREE_ID = 'wt-1'
const GROUP_ID = 'group-a'

function agentSessionTab(): Tab {
  return {
    id: 'agent-tab-1',
    entityId: 'session-1',
    groupId: GROUP_ID,
    worktreeId: WORKTREE_ID,
    contentType: 'agent-session',
    agentSessionAgent: 'codex',
    label: 'Codex Chat',
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

function group(): TabGroup {
  return { id: GROUP_ID, worktreeId: WORKTREE_ID, activeTabId: null, tabOrder: ['agent-tab-1'] }
}

describe('activateTabNumberShortcut (agent session)', () => {
  afterEach(() => {
    activateStructuredAgentSessionTabMock.mockClear()
    useAppStore.setState({
      unifiedTabsByWorktree: {},
      groupsByWorktree: {},
      activeGroupIdByWorktree: {}
    })
  })

  it('routes an agent-session target through its structured activation path', () => {
    useAppStore.setState({
      activeView: 'terminal',
      activeWorktreeId: WORKTREE_ID,
      activeGroupIdByWorktree: { [WORKTREE_ID]: GROUP_ID },
      groupsByWorktree: { [WORKTREE_ID]: [group()] },
      unifiedTabsByWorktree: { [WORKTREE_ID]: [agentSessionTab()] }
    })

    expect(activateTabNumberShortcut(0)).toBe(true)
    expect(activateStructuredAgentSessionTabMock).toHaveBeenCalledWith({
      worktreeId: WORKTREE_ID,
      tabId: 'agent-tab-1'
    })
  })
})
