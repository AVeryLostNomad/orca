import { afterEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import type { CodeServerTab, Tab, TabGroup } from '../../../shared/types'
import { activateTabNumberShortcut } from './tab-number-shortcuts'

const WORKTREE_ID = 'wt-1'
const GROUP_ID = 'group-a'

function vscodeUnifiedTab(): Tab {
  return {
    id: 'tab-v1',
    entityId: 'cs-1',
    groupId: GROUP_ID,
    worktreeId: WORKTREE_ID,
    contentType: 'vscode',
    label: 'VS Code',
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

function group(): TabGroup {
  return { id: GROUP_ID, worktreeId: WORKTREE_ID, activeTabId: null, tabOrder: ['tab-v1'] }
}

function codeServerTab(): CodeServerTab {
  return { id: 'cs-1', worktreeId: WORKTREE_ID, folderPath: '/repo', label: 'VS Code' }
}

describe('activateTabNumberShortcut (vscode)', () => {
  afterEach(() => {
    useAppStore.setState({
      activeCodeServerTabIdByWorktree: {},
      codeServerTabsByWorktree: {},
      unifiedTabsByWorktree: {},
      groupsByWorktree: {},
      activeGroupIdByWorktree: {}
    })
  })

  it('activates a vscode target as the vscode surface, not the editor', () => {
    // Regression (I3): vscode used to fall into the editor else, setting
    // activeFileId to the vscode tab id and activeTabType to 'editor'.
    useAppStore.setState({
      activeView: 'terminal',
      activeWorktreeId: WORKTREE_ID,
      activeGroupIdByWorktree: { [WORKTREE_ID]: GROUP_ID },
      groupsByWorktree: { [WORKTREE_ID]: [group()] },
      unifiedTabsByWorktree: { [WORKTREE_ID]: [vscodeUnifiedTab()] },
      codeServerTabsByWorktree: { [WORKTREE_ID]: [codeServerTab()] },
      activeCodeServerTabIdByWorktree: {}
    })

    const activated = activateTabNumberShortcut(0)

    expect(activated).toBe(true)
    const state = useAppStore.getState()
    expect(state.activeTabType).toBe('vscode')
    expect(state.activeCodeServerTabIdByWorktree[WORKTREE_ID]).toBe('cs-1')
  })
})
