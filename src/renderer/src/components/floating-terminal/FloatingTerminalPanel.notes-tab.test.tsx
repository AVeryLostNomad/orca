import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FLOATING_TERMINAL_WORKTREE_ID,
  FLOATING_WORKSPACE_NOTES_TAB_ID
} from '../../../../shared/constants'
import type { Tab } from '../../../../shared/tab-types'
import {
  makeTab,
  setFloatingTabs,
  storeBox,
  type FloatingPanelStoreState
} from './floating-terminal-panel-test-fixtures'
import { mocks, setupFloatingTerminalPanelTest } from './floating-terminal-panel-test-harness'
import {
  findByTypeName,
  flushAsyncWork,
  renderPanel,
  runEffects
} from './floating-terminal-panel-render-probe'

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react') // eslint-disable-line @typescript-eslint/consistent-type-imports -- vi.importActual requires inline import()
  const { createReactHookOverrides } = await import('./floating-terminal-panel-test-module-mocks')
  return { ...actual, ...createReactHookOverrides() }
})

vi.mock('@/store', async () => {
  return (await import('./floating-terminal-panel-test-module-mocks')).createAppStoreModule()
})

vi.mock('@/components/tab-bar/TabBar', async () => {
  return (await import('./floating-terminal-panel-component-stubs')).createTabBarModule()
})

vi.mock('@/components/terminal-pane/TerminalPane', async () => {
  return (await import('./floating-terminal-panel-component-stubs')).createTerminalPaneModule()
})

vi.mock('@/components/terminal-pane/use-terminal-tab-cold-parking', async () => {
  return (await import('./floating-terminal-panel-test-module-mocks')).createColdParkingModule()
})

vi.mock('@/components/terminal-pane/terminal-parked-tab-watchers', async () => {
  return (
    await import('./floating-terminal-panel-test-module-mocks')
  ).createParkedTabWatchersModule()
})

vi.mock('@/components/terminal-pane/terminal-ime-input-context-refresh', async () => {
  return (
    await import('./floating-terminal-panel-test-module-mocks')
  ).createImeInputContextRefreshModule()
})

vi.mock('@/components/terminal/terminal-tab-actions', async () => {
  return (
    await import('./floating-terminal-panel-test-module-mocks')
  ).createTerminalTabActionsModule()
})

vi.mock('@/store/pinned-tab-close-guard', async () => {
  return (
    await import('./floating-terminal-panel-test-module-mocks')
  ).createPinnedTabCloseGuardModule()
})

vi.mock('@/components/browser-pane/BrowserPane', async () => {
  return (await import('./floating-terminal-panel-component-stubs')).createBrowserPaneModule()
})

vi.mock('@/components/emulator-pane/EmulatorPane', async () => {
  return (await import('./floating-terminal-panel-component-stubs')).createEmulatorPaneModule()
})

vi.mock('@/components/editor/EditorPanel', async () => {
  return (await import('./floating-terminal-panel-component-stubs')).createEditorPanelModule()
})

vi.mock('@/components/ui/button', async () => {
  return (await import('./floating-terminal-panel-component-stubs')).createButtonModule()
})

vi.mock('@/components/contextual-tours/use-contextual-tour', async () => {
  return (await import('./floating-terminal-panel-test-module-mocks')).createContextualTourModule()
})

vi.mock('@/components/ui/dialog', async () => {
  return (await import('./floating-terminal-panel-component-stubs')).createDialogModule()
})

vi.mock('@/components/terminal/useTerminalSaveDialog', async () => {
  return (
    await import('./floating-terminal-panel-test-module-mocks')
  ).createTerminalSaveDialogModule()
})

vi.mock('@/runtime/web-runtime-session', async () => {
  return (
    await import('./floating-terminal-panel-test-module-mocks')
  ).createWebRuntimeSessionModule()
})

vi.mock('@/lib/connection-context', async () => {
  return (
    await import('./floating-terminal-panel-test-module-mocks')
  ).createConnectionContextModule()
})

// Why inline and sync: this module is imported by the test file itself, so an async factory
// resolves too late and the panel ends up calling a second copy of the mock.
vi.mock('@/lib/create-untitled-markdown', () => ({
  createUntitledMarkdownFileWithTemplateSelection: vi.fn()
}))

vi.mock('@/lib/ipc-error', async () => {
  return (await import('./floating-terminal-panel-test-module-mocks')).createIpcErrorModule()
})

vi.mock('sonner', async () => {
  return (await import('./floating-terminal-panel-test-module-mocks')).createSonnerModule()
})

vi.mock('@/lib/focus-terminal-tab-surface', async () => {
  return (
    await import('./floating-terminal-panel-test-module-mocks')
  ).createFocusTerminalTabSurfaceModule()
})

vi.mock('@/lib/orchestration-setup-state', async () => {
  return (
    await import('./floating-terminal-panel-test-module-mocks')
  ).createOrchestrationSetupStateModule()
})

vi.mock('./FloatingTerminalOrchestrationDialog', async () => {
  return (
    await import('./floating-terminal-panel-component-stubs')
  ).createOrchestrationDialogModule()
})

vi.mock('./FloatingTerminalResizeHandles', async () => {
  return (await import('./floating-terminal-panel-component-stubs')).createResizeHandlesModule()
})

vi.mock('./FloatingTerminalToggleButton', async () => {
  return (await import('./floating-terminal-panel-component-stubs')).createToggleButtonModule()
})

vi.mock('./FloatingTerminalWindowControls', async () => {
  return (await import('./floating-terminal-panel-component-stubs')).createWindowControlsModule()
})

vi.mock('@/components/ShortcutKeyCombo', async () => {
  return (await import('./floating-terminal-panel-component-stubs')).createShortcutKeyComboModule()
})

function makeNotesTab(groupId = 'floating-group'): Tab {
  return {
    id: FLOATING_WORKSPACE_NOTES_TAB_ID,
    entityId: FLOATING_WORKSPACE_NOTES_TAB_ID,
    groupId,
    worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
    contentType: 'workspace-notes',
    label: 'Notes',
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 0,
    isPinned: true
  }
}

/** Seeds the permanent notes tab as the group's only tab; active by default. */
function setFloatingNotesTab({ active = true }: { active?: boolean } = {}): Tab {
  const state = storeBox.state as FloatingPanelStoreState
  const groupId = 'floating-group'
  const tab = makeNotesTab(groupId)
  state.unifiedTabsByWorktree = { [FLOATING_TERMINAL_WORKTREE_ID]: [tab] }
  state.groupsByWorktree = {
    [FLOATING_TERMINAL_WORKTREE_ID]: [
      {
        id: groupId,
        worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
        activeTabId: active ? tab.id : null,
        tabOrder: [tab.id],
        recentTabIds: active ? [tab.id] : []
      }
    ]
  }
  state.activeGroupIdByWorktree = { [FLOATING_TERMINAL_WORKTREE_ID]: groupId }
  state.tabBarOrderByWorktree = { [FLOATING_TERMINAL_WORKTREE_ID]: [tab.id] }
  return tab
}

describe('FloatingTerminalPanel workspace-notes tab', () => {
  beforeEach(setupFloatingTerminalPanelTest)

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('ensures the notes tab on mount when it is missing', async () => {
    await renderPanel(true)
    runEffects()
    await flushAsyncWork()

    expect(mocks.createUnifiedTab).toHaveBeenCalledWith(
      FLOATING_TERMINAL_WORKTREE_ID,
      'workspace-notes',
      expect.objectContaining({
        id: FLOATING_WORKSPACE_NOTES_TAB_ID,
        entityId: FLOATING_WORKSPACE_NOTES_TAB_ID,
        isPinned: true,
        activate: false
      })
    )
  })

  it('does not recreate the notes tab when it already exists', async () => {
    setFloatingNotesTab()

    await renderPanel(true)
    runEffects()
    await flushAsyncWork()

    expect(mocks.createUnifiedTab).not.toHaveBeenCalled()
  })

  it('passes the leading notes chip to the tab bar', async () => {
    setFloatingNotesTab({ active: false })
    const element = await renderPanel(true)

    const tabBar = findByTypeName(element, 'TabBar')
    expect(tabBar.props.workspaceNotesTab).toMatchObject({
      tabId: FLOATING_WORKSPACE_NOTES_TAB_ID,
      isActive: false
    })
  })

  it('renders the notes pane only when the notes tab is explicitly active', async () => {
    setFloatingNotesTab({ active: true })
    const activeElement = await renderPanel(true)
    expect(findByTypeName(activeElement, 'WorkspaceNotesPane')).toBeTruthy()
    expect(() => findByTypeName(activeElement, 'FloatingTerminalEmptyState')).toThrow(
      'FloatingTerminalEmptyState not found'
    )
  })

  it('keeps the first-run empty state when the notes tab exists but was never activated', async () => {
    setFloatingNotesTab({ active: false })
    const element = await renderPanel(true)

    expect(findByTypeName(element, 'FloatingTerminalEmptyState')).toBeTruthy()
    expect(() => findByTypeName(element, 'WorkspaceNotesPane')).toThrow(
      'WorkspaceNotesPane not found'
    )
  })

  it('refuses every close path for the notes tab', async () => {
    setFloatingNotesTab({ active: true })
    const element = await renderPanel(true)
    const tabBar = findByTypeName(element, 'TabBar')

    ;(tabBar.props.onClose as (visibleId: string) => void)(FLOATING_WORKSPACE_NOTES_TAB_ID)
    ;(tabBar.props.onCloseFile as (visibleId: string) => void)(FLOATING_WORKSPACE_NOTES_TAB_ID)

    expect(mocks.closeUnifiedTab).not.toHaveBeenCalled()
    expect(mocks.closeFile).not.toHaveBeenCalled()
    expect(mocks.closeTab).not.toHaveBeenCalled()
    expect(mocks.guardPinnedTabClose).not.toHaveBeenCalled()
  })

  it('close-others leaves the notes tab alone', async () => {
    const state = storeBox.state as FloatingPanelStoreState
    setFloatingTabs([makeTab({ id: 'term-1' })])
    const groupId = 'floating-group'
    const notesTab = makeNotesTab(groupId)
    state.unifiedTabsByWorktree = {
      [FLOATING_TERMINAL_WORKTREE_ID]: [
        ...(state.unifiedTabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID] ?? []),
        notesTab
      ]
    }
    state.groupsByWorktree[FLOATING_TERMINAL_WORKTREE_ID][0].tabOrder.push(notesTab.id)

    const element = await renderPanel(true)
    const tabBar = findByTypeName(element, 'TabBar')
    ;(tabBar.props.onCloseOthers as (visibleId: string) => void)('term-1')

    expect(mocks.closeUnifiedTab).not.toHaveBeenCalled()
    expect(mocks.closeFile).not.toHaveBeenCalled()
    expect(mocks.closeTab).not.toHaveBeenCalled()
  })
})
