import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../store'
import type { usePluginCommands } from '@/store/plugin-panels'
import type { KeybindingContext, PhysicalModifierToken } from '../../../shared/keybindings'

type AppStoreState = ReturnType<typeof useAppStore.getState>

// Share dispatch between KeyboardEvent and synthetic double-tap input.
export type ShortcutDispatchInput = {
  isComposing?: boolean
  altGraph?: boolean
  key?: string
  code?: string
  altKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  doubleTapModifier?: PhysicalModifierToken
  target: EventTarget | null
  defaultPrevented: boolean
  preventDefault: () => void
}

export type AppShortcutActions = ReturnType<typeof useAppShortcutActions>

export type AppShortcutState = {
  activeView: AppStoreState['activeView']
  activeWorktreeId: AppStoreState['activeWorktreeId']
  actions: AppShortcutActions
  creationLayoutActive: boolean
  floatingTerminalEnabled: boolean
  floatingTerminalOpen: boolean
  floatingVisibleTabCount: number
  keybindings: AppStoreState['keybindings']
  openFloatingWorkspaceMaximized: () => void
  pluginCommands: ReturnType<typeof usePluginCommands>
  setFloatingTerminalOpen: (open: boolean) => void
  terminalShortcutPolicy: NonNullable<AppStoreState['settings']>['terminalShortcutPolicy']
  workspaceChromeActive: boolean
}

export function useAppShortcutActions() {
  // One shallow action subscription avoids an equality check per action on every store mutation.
  return useAppStore(
    useShallow((s) => ({
      toggleSidebar: s.toggleSidebar,
      toggleRightSidebar: s.toggleRightSidebar,
      setRightSidebarOpen: s.setRightSidebarOpen,
      setRightSidebarTab: s.setRightSidebarTab,
      showRightSidebarFiles: s.showRightSidebarFiles,
      showRightSidebarSearch: s.showRightSidebarSearch,
      openDiffNotesSendMenuForActiveWorktree: s.openDiffNotesSendMenuForActiveWorktree
    }))
  )
}

export function getKeybindingContext(target: EventTarget | null): KeybindingContext {
  return target instanceof HTMLElement && target.classList.contains('xterm-helper-textarea')
    ? 'terminal'
    : 'app'
}
