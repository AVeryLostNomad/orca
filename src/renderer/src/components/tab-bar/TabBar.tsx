import React from 'react'
import { useTabStripOverflowNavigation } from './tab-strip-overflow-navigation'
import { useTabStripDragScrollHandlers } from './tab-strip-drag-scroll'
import type { TabBarProps } from './tab-bar-props'
import type { TabBarItem } from './tab-bar-item-model'
import { useTabBarRuntimeModel } from './use-tab-bar-runtime-model'
import { useTabBarCreateMenuController } from './use-tab-bar-create-menu-controller'
import { useTabBarItemProjection } from './use-tab-bar-item-projection'
import { renderTabBarSurface } from './tab-bar-surface'
import { resolveVSCodeTabCreateGate } from './vscode-tab-create-gate'
import { resolveDataStudioTabCreateGate } from './data-studio-tab-create-gate'

function TabBarInner(props: TabBarProps): React.JSX.Element {
  const {
    worktreeId,
    groupId,
    terminalOnly = false,
    onNewTerminalTab,
    onNewTerminalWithShell,
    onNewBrowserTab,
    onNewVSCodeTab,
    onNewDataStudioTab,
    onNewSimulatorTab,
    onNewFileTab,
    onOpenFileTab,
    onPinFile
  } = props
  const runtime = useTabBarRuntimeModel({ worktreeId, groupId })
  const vscodeCreateGate = resolveVSCodeTabCreateGate({
    terminalOnly,
    isLocalWorktree: runtime.isLocalWorktree,
    hasCreateCallback: Boolean(onNewVSCodeTab),
    settingEnabled: runtime.vscodeTabOptionEnabled
  })
  const dataStudioCreateGate = resolveDataStudioTabCreateGate({
    terminalOnly,
    isLocalWorktree: runtime.isLocalWorktree,
    hasRepoId: runtime.hasRepoBackedWorkspace,
    hasCreateCallback: Boolean(onNewDataStudioTab),
    settingEnabled: runtime.dataStudioTabOptionEnabled
  })
  const createMenu = useTabBarCreateMenuController({
    worktreeId,
    resolvedGroupId: runtime.resolvedGroupId,
    terminalOnly,
    mobileEmulatorEnabled: runtime.mobileEmulatorEnabled,
    managedBrowserCreationEnabled: runtime.managedBrowserCreationEnabled,
    mobileEmulatorCreationEnabled: runtime.mobileEmulatorCreationEnabled,
    workspaceHasSimulatorTab: runtime.workspaceHasSimulatorTab,
    showWindowsShellMenu: runtime.showWindowsShellMenu,
    projectRuntimeShellMenuMode: runtime.projectRuntimeShellMenuMode,
    defaultWindowsShell: runtime.defaultWindowsShell,
    defaultWindowsPowerShellImplementation: runtime.defaultWindowsPowerShellImplementation,
    windowsTerminalCapabilities: runtime.windowsTerminalCapabilities,
    agentLaunchOptions: runtime.agentLaunchOptions,
    hasNewVSCode: vscodeCreateGate.hasNewVSCode,
    hasNewDataStudio: dataStudioCreateGate.hasNewDataStudio,
    onNewTerminalTab,
    onNewTerminalWithShell,
    onNewBrowserTab,
    onNewVSCodeTab,
    onNewDataStudioTab,
    onNewSimulatorTab,
    onNewFileTab,
    onOpenFileTab
  })
  const itemProjection = useTabBarItemProjection({
    props,
    resolvedGroupId: runtime.resolvedGroupId,
    unifiedTabs: runtime.unifiedTabs,
    unifiedTabByVisibleId: runtime.unifiedTabByVisibleId,
    generatedTabTitlesEnabled: runtime.generatedTabTitlesEnabled,
    statusByRelativePath: runtime.statusByRelativePath
  })
  const togglePinned = (item: TabBarItem): void => {
    // pinTab/unpinTab mirror the change to the host for remote-server tabs.
    if (item.isPinned) {
      runtime.unpinTab(item.unifiedTabId)
      return
    }
    if (item.type === 'editor' && onPinFile) {
      onPinFile(item.data.id, item.unifiedTabId)
      return
    }
    runtime.pinTab(item.unifiedTabId)
  }
  const tabStripNavigation = useTabStripOverflowNavigation({
    activeVisibleTabId: itemProjection.activeVisibleTabId,
    layoutKey: itemProjection.tabStripLayoutKey,
    tabCount: itemProjection.orderedItems.length,
    worktreeId
  })
  const tabStripDragScroll = useTabStripDragScrollHandlers(tabStripNavigation.scrollTabStrip, {
    start: tabStripNavigation.tabStripOverflowState.canScrollStart,
    end: tabStripNavigation.tabStripOverflowState.canScrollEnd
  })

  return renderTabBarSurface({
    props,
    runtime,
    createMenu,
    vscodeCreateGate,
    dataStudioCreateGate,
    itemProjection,
    tabStripNavigation,
    tabStripDragScroll,
    togglePinned
  })
}

export default React.memo(TabBarInner)
