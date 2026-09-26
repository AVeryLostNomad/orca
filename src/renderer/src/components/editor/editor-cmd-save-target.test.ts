import { describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import type { Tab } from '../../../../shared/tab-types'
import { getEditorCmdSaveTabId } from './editor-cmd-save-target'

function makeTab(contentType: Tab['contentType'], entityId: string): Tab {
  return {
    id: `tab-${entityId}`,
    entityId,
    contentType,
    label: entityId,
    groupId: 'group-1',
    worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

describe('getEditorCmdSaveTabId', () => {
  it('targets the main active editor surface when the floating panel does not own the event', () => {
    const getActiveTab = vi.fn(() => makeTab('editor', 'main-file'))

    expect(
      getEditorCmdSaveTabId(
        {
          activeTabType: 'editor',
          activeView: 'terminal',
          activeWorktreeId: 'repo-1::/repo/worktree',
          getActiveTab
        },
        false
      )
    ).toBe('tab-main-file')
    expect(getActiveTab).toHaveBeenCalledWith('repo-1::/repo/worktree')
  })

  it('claims nothing on a non-workspace view so the shortcut is not swallowed', () => {
    const getActiveTab = vi.fn(() => null)

    for (const activeView of ['tasks', 'automations', 'activity'] as const) {
      expect(
        getEditorCmdSaveTabId(
          {
            activeTabType: 'editor',
            activeView,
            activeWorktreeId: 'repo-1::/repo/worktree',
            getActiveTab
          },
          false
        )
      ).toBeNull()
    }
  })

  it('targets only an active floating editor and never falls through to main', () => {
    const getActiveTab = vi
      .fn<(worktreeId: string) => Tab | null>()
      .mockReturnValueOnce(makeTab('editor', 'floating-file'))
      .mockReturnValueOnce(makeTab('browser', 'floating-browser'))
    const state = {
      activeTabType: 'editor',
      activeView: 'terminal' as const,
      activeWorktreeId: 'repo-1::/repo/worktree',
      getActiveTab
    }

    expect(getEditorCmdSaveTabId(state, true)).toBe('tab-floating-file')
    expect(getEditorCmdSaveTabId(state, true)).toBeNull()
    expect(getActiveTab).toHaveBeenNthCalledWith(1, FLOATING_TERMINAL_WORKTREE_ID)
    expect(getActiveTab).toHaveBeenNthCalledWith(2, FLOATING_TERMINAL_WORKTREE_ID)
  })

  it('still targets the floating editor from a non-workspace view', () => {
    const getActiveTab = vi.fn(() => makeTab('editor', 'floating-file'))

    expect(
      getEditorCmdSaveTabId(
        {
          activeTabType: 'editor',
          activeView: 'tasks',
          activeWorktreeId: 'repo-1::/repo/worktree',
          getActiveTab
        },
        true
      )
    ).toBe('tab-floating-file')
  })
})
