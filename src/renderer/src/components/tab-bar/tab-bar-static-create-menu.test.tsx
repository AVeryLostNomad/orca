import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { TabBarProps } from './tab-bar-props'
import { renderTabBarStaticCreateMenu } from './tab-bar-static-create-menu'

function baseProps(onNewPopupTerminal?: () => void): TabBarProps {
  return {
    tabs: [],
    activeTabId: null,
    worktreeId: 'workspace-1',
    expandedPaneByTabId: {},
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onCloseOthers: vi.fn(),
    onCloseToRight: vi.fn(),
    onCloseToLeft: vi.fn(),
    onNewTerminalTab: vi.fn(),
    onNewPopupTerminal,
    onNewBrowserTab: vi.fn(),
    onSetCustomTitle: vi.fn(),
    onSetTabColor: vi.fn(),
    onTogglePaneExpand: vi.fn()
  }
}

type MenuItemProps = {
  children?: React.ReactNode
  onSelect?: () => void
}

function menuItems(props: TabBarProps): React.ReactElement<MenuItemProps>[] {
  const menu = renderTabBarStaticCreateMenu({
    props,
    terminalOnly: false,
    mobileEmulatorEnabled: false,
    managedBrowserCreationEnabled: false,
    mobileEmulatorCreationEnabled: false,
    workspaceHasSimulatorTab: false,
    showMobileEmulatorIntroCallout: false,
    hasNewVSCode: false,
    vscodeRemoteDisabled: false,
    hasNewDataStudio: false,
    dataStudioRemoteDisabled: false,
    hasNewScratchFile: false,
    windowsShellEntries: undefined,
    defaultWindowsPowerShellImplementation: 'auto',
    pwshAvailable: false,
    newTerminalShortcut: '⌘T',
    newPopupTerminalShortcut: '⌘⇧Space',
    newBrowserShortcut: '⌘⇧B',
    newSimulatorShortcut: '',
    newFileShortcut: '',
    openMarkdownShortcut: null,
    queueNewActiveTerminalFocusAfterNewTabMenuClose: vi.fn()
  })
  if (!React.isValidElement<{ children?: React.ReactNode }>(menu)) {
    return []
  }
  return React.Children.toArray(menu.props.children).filter(
    (child): child is React.ReactElement<MenuItemProps> =>
      React.isValidElement<MenuItemProps>(child)
  )
}

describe('tab bar static create menu', () => {
  it('offers a popup terminal only on workspace tab bars that support it', () => {
    const onNewPopupTerminal = vi.fn()
    const popupItem = menuItems(baseProps(onNewPopupTerminal)).find(
      (item) => item.props.onSelect === onNewPopupTerminal
    )

    if (!popupItem) {
      throw new Error('Popup terminal menu item missing')
    }
    expect(React.Children.toArray(popupItem.props.children)).toContain('New Popup Terminal')
    popupItem.props.onSelect?.()
    expect(onNewPopupTerminal).toHaveBeenCalledOnce()

    expect(menuItems(baseProps()).some((item) => item.props.onSelect === onNewPopupTerminal)).toBe(
      false
    )
  })
})
