import { translateMain } from '../i18n/main-i18n'

export function buildFileMenu(args: {
  isMac: boolean
  onOpenFilePicker: () => void
  settingsItem: Electron.MenuItemConstructorOptions
}): Electron.MenuItemConstructorOptions {
  const openFileItem: Electron.MenuItemConstructorOptions = {
    label: translateMain('menu.openFile', 'Open File...'),
    click: () => args.onOpenFilePicker()
  }
  if (args.isMac) {
    // Why: Settings/Quit live in the mac app menu; File carries only open actions there.
    return {
      label: translateMain('menu.file', 'File'),
      submenu: [
        openFileItem,
        { role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] }
      ]
    }
  }
  // Why: on Windows/Linux there is no app-named menu, so Settings and
  // Quit live under File — matching the common platform convention and
  // keeping all user-facing actions reachable from the in-window menu bar.
  return {
    label: translateMain('menu.file', 'File'),
    submenu: [
      openFileItem,
      { type: 'separator' },
      args.settingsItem,
      { type: 'separator' },
      { role: 'quit', label: translateMain('menu.exit', 'Exit') }
    ]
  }
}
