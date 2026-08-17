import type { WindowsTerminalCapabilities } from '@/lib/windows-terminal-capabilities'
import type { TabCreateMenuOption } from './tab-create-menu-options'
import { resolveWindowsShellLaunchTarget } from './windows-shell-launch'
import type { resolveWindowsPowerShellImplementationSetting } from './use-tab-bar-runtime-model'

export type TabCreateMenuOptionDispatchDeps = {
  queueNewActiveTerminalFocusAfterNewTabMenuClose: () => void
  defaultWindowsPowerShellImplementation: ReturnType<
    typeof resolveWindowsPowerShellImplementationSetting
  >
  windowsTerminalCapabilities: WindowsTerminalCapabilities
  onNewTerminalTab: () => void
  onNewTerminalWithShell?: (shell: string) => void
  onNewBrowserTab: () => void
  onNewVSCodeTab?: () => void
  onNewDataStudioTab?: () => void
  onNewSimulatorTab?: () => void
  onNewFileTab?: () => void
  onOpenFileTab?: () => void
}

export function dispatchTabCreateMenuOption(
  option: TabCreateMenuOption,
  deps: TabCreateMenuOptionDispatchDeps
): void {
  switch (option.kind) {
    case 'new-terminal':
      deps.queueNewActiveTerminalFocusAfterNewTabMenuClose()
      deps.onNewTerminalTab()
      break
    case 'new-terminal-shell':
      if (!deps.onNewTerminalWithShell || !option.shell) {
        break
      }
      deps.queueNewActiveTerminalFocusAfterNewTabMenuClose()
      deps.onNewTerminalWithShell(
        resolveWindowsShellLaunchTarget(
          option.shell,
          deps.defaultWindowsPowerShellImplementation,
          deps.windowsTerminalCapabilities.pwshAvailable
        )
      )
      break
    case 'new-browser':
      deps.onNewBrowserTab()
      break
    case 'new-vscode':
      deps.onNewVSCodeTab?.()
      break
    case 'new-datastudio':
      deps.onNewDataStudioTab?.()
      break
    case 'new-markdown':
      deps.onNewFileTab?.()
      break
    case 'open-markdown':
      deps.onOpenFileTab?.()
      break
    case 'new-simulator':
    case 'go-to-simulator':
      deps.onNewSimulatorTab?.()
      break
  }
}
