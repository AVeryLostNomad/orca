import { describe, expect, it } from 'vitest'

import { parseWorkspaceSession } from './workspace-session-schema'

const MINIMAL_SESSION = {
  activeRepoId: null,
  activeWorktreeId: null,
  activeTabId: null,
  tabsByWorktree: {},
  terminalLayoutsByTabId: {}
}

describe('workspaceSessionStateSchema field coverage', () => {
  it('round-trips the closed-tab tombstone map through parseWorkspaceSession', () => {
    // The regression this file exists for. Recorded on close, written to disk, stripped on the next
    // launch — so a close the transport never delivered resurrected after a quit-and-relaunch,
    // which is precisely the reported shape ("every day I open orca and it opens more tabs").
    const parsed = parseWorkspaceSession({
      ...MINIMAL_SESSION,
      closedTerminalTabTombstonesByTabId: {
        'tab-1': { closedAt: 1_700_000_000_000, worktreeId: 'repo:wt-1', ackRevision: 4 }
      }
    })

    expect(parsed.ok).toBe(true)
    expect(parsed.ok && parsed.value.closedTerminalTabTombstonesByTabId).toEqual({
      'tab-1': { closedAt: 1_700_000_000_000, worktreeId: 'repo:wt-1', ackRevision: 4 }
    })
  })

  it('salvages a malformed tombstone entry rather than dropping the whole map', () => {
    const parsed = parseWorkspaceSession({
      ...MINIMAL_SESSION,
      closedTerminalTabTombstonesByTabId: {
        'tab-good': { closedAt: 1, worktreeId: 'repo:wt-1' },
        'tab-bad': { closedAt: 'nope', worktreeId: 'repo:wt-1' }
      }
    })

    expect(parsed.ok).toBe(true)
    expect(
      Object.keys((parsed.ok && parsed.value.closedTerminalTabTombstonesByTabId) || {})
    ).toEqual(['tab-good'])
  })
})
