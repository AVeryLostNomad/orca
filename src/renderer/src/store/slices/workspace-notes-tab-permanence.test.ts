import { describe, it, expect, beforeEach, vi } from 'vitest'
import type * as AgentStatusModule from '@/lib/agent-status'
import { createTabsSliceMockApi } from './tabs-slice-test-harness'
import { createTestStore } from './store-test-helpers'
import {
  ensureFloatingWorkspaceNotesTab,
  isPermanentFloatingTab,
  resolveWorkspaceDisplayName
} from '@/lib/floating-workspace-notes-tab'
import {
  FLOATING_TERMINAL_WORKTREE_ID,
  FLOATING_WORKSPACE_NOTES_TAB_ID
} from '../../../../shared/constants'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'

// Mock sonner (imported by repos.ts)
vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))

// Mock agent-status (imported by terminal-helpers)
vi.mock('@/lib/agent-status', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentStatusModule>()
  return {
    ...actual,
    detectAgentStatusFromTitle: vi.fn().mockReturnValue(null)
  }
})

createTabsSliceMockApi()

describe('workspace-notes tab permanence', () => {
  let store: ReturnType<typeof createTestStore>

  beforeEach(() => {
    store = createTestStore()
  })

  function floatingTabs(): { id: string; entityId: string }[] {
    return store.getState().unifiedTabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID] ?? []
  }

  it('ensureFloatingWorkspaceNotesTab creates one pinned tab, idempotently', () => {
    const created = ensureFloatingWorkspaceNotesTab(store.getState())
    expect(created.id).toBe(FLOATING_WORKSPACE_NOTES_TAB_ID)
    expect(created.contentType).toBe('workspace-notes')
    expect(created.isPinned).toBe(true)
    expect(isPermanentFloatingTab(created)).toBe(true)

    const again = ensureFloatingWorkspaceNotesTab(store.getState())
    expect(again.id).toBe(FLOATING_WORKSPACE_NOTES_TAB_ID)
    expect(floatingTabs().filter((tab) => tab.id === FLOATING_WORKSPACE_NOTES_TAB_ID)).toHaveLength(
      1
    )
  })

  it('does not steal group activation on creation', () => {
    const terminal = store
      .getState()
      .createUnifiedTab(FLOATING_TERMINAL_WORKTREE_ID, 'terminal', { id: 'term-1' })
    ensureFloatingWorkspaceNotesTab(store.getState())
    const group = store
      .getState()
      .groupsByWorktree[FLOATING_TERMINAL_WORKTREE_ID]?.find((g) => g.id === terminal.groupId)
    expect(group?.activeTabId).toBe('term-1')
  })

  it('closeUnifiedTab refuses to close the notes tab', () => {
    ensureFloatingWorkspaceNotesTab(store.getState())
    const result = store.getState().closeUnifiedTab(FLOATING_WORKSPACE_NOTES_TAB_ID)
    expect(result).toBeNull()
    expect(floatingTabs().some((tab) => tab.id === FLOATING_WORKSPACE_NOTES_TAB_ID)).toBe(true)
  })

  it('unpinTab refuses to unpin the notes tab', () => {
    ensureFloatingWorkspaceNotesTab(store.getState())
    store.getState().unpinTab(FLOATING_WORKSPACE_NOTES_TAB_ID)
    expect(store.getState().getTab(FLOATING_WORKSPACE_NOTES_TAB_ID)?.isPinned).toBe(true)
  })

  it('openFile with suppressUnifiedTab opens the file without a unified tab', () => {
    const fileId = store.getState().openFile(
      {
        filePath: '/notes/notes.md',
        relativePath: 'notes.md',
        worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
        language: 'markdown',
        mode: 'edit',
        runtimeEnvironmentId: null,
        alwaysAutoSave: true,
        workspaceNotesOwnerId: 'repo-1::/tmp/wt-a'
      },
      { preview: false, suppressUnifiedTab: true, suppressActiveRuntimeFallback: true }
    )

    const file = store.getState().openFiles.find((candidate) => candidate.id === fileId)
    expect(file?.alwaysAutoSave).toBe(true)
    expect(file?.workspaceNotesOwnerId).toBe('repo-1::/tmp/wt-a')
    expect(floatingTabs().some((tab) => tab.entityId === fileId)).toBe(false)
  })

  describe('resolveWorkspaceDisplayName', () => {
    it('resolves a worktree displayName', () => {
      const state = {
        worktreesByRepo: {
          'repo-1': [{ id: 'repo-1::/tmp/wt-a', displayName: 'My Feature' }]
        },
        folderWorkspaces: []
      } as never
      expect(resolveWorkspaceDisplayName(state, 'repo-1::/tmp/wt-a')).toBe('My Feature')
    })

    it('resolves a folder workspace name from its key', () => {
      const state = {
        worktreesByRepo: {},
        folderWorkspaces: [{ id: 'folder-1', name: 'Docs Folder' }]
      } as never
      expect(resolveWorkspaceDisplayName(state, folderWorkspaceKey('folder-1'))).toBe('Docs Folder')
    })

    it('falls back to the last path segment for an unknown worktree id, never the raw id', () => {
      const state = { worktreesByRepo: {}, folderWorkspaces: [] } as never
      expect(
        resolveWorkspaceDisplayName(
          state,
          'c9419240-3ea7-47f4-ac40-899caac02116::/Users/joey/orca/workspaces/misfit-guild/coney'
        )
      ).toBe('coney')
      expect(
        resolveWorkspaceDisplayName(state, 'repo-1::C:\\Users\\joey\\worktrees\\my-feature')
      ).toBe('my-feature')
      expect(resolveWorkspaceDisplayName(state, 'ghost-id')).toBe('ghost-id')
    })

    it('falls back past a blank displayName to the path segment', () => {
      const state = {
        worktreesByRepo: {
          'repo-1': [{ id: 'repo-1::/tmp/worktrees/blank-name', displayName: '  ' }]
        },
        folderWorkspaces: []
      } as never
      expect(resolveWorkspaceDisplayName(state, 'repo-1::/tmp/worktrees/blank-name')).toBe(
        'blank-name'
      )
    })
  })
})
