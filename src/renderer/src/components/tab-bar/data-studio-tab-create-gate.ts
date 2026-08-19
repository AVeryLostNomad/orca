import { getRendererAppPlatform } from '@/lib/renderer-app-platform'

export type DataStudioTabCreateGate = {
  /** Show the enabled "New Data Studio Tab" entry (searchable + static menu). */
  hasNewDataStudio: boolean
  /** mac/linux + remote worktree: show a disabled entry with an explanatory
   *  tooltip (never added to the searchable options list). */
  dataStudioRemoteDisabled: boolean
}

// Data Studio (the embedded Azure Data Studio web server) runs against local
// checkouts on mac/linux/windows — unlike the VS Code tab, the ADS server has
// a Windows artifact. It additionally requires a repoId — connections are
// scoped per repo, so group folder workspaces (which have no repoId) never
// offer the tab.
export function resolveDataStudioTabCreateGate({
  terminalOnly,
  isLocalWorktree,
  hasRepoId,
  hasCreateCallback,
  settingEnabled = true
}: {
  terminalOnly: boolean
  isLocalWorktree: boolean
  hasRepoId: boolean
  hasCreateCallback: boolean
  /** Settings opt-out hides both entries (no disabled-with-tooltip row). */
  settingEnabled?: boolean
}): DataStudioTabCreateGate {
  const platform = getRendererAppPlatform()
  const platformSupported = platform === 'darwin' || platform === 'linux' || platform === 'win32'
  const base =
    !terminalOnly && platformSupported && hasRepoId && hasCreateCallback && settingEnabled
  return {
    hasNewDataStudio: base && isLocalWorktree,
    dataStudioRemoteDisabled: base && !isLocalWorktree
  }
}
