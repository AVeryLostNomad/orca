import { getRendererAppPlatform } from '@/lib/renderer-app-platform'

export type VSCodeTabCreateGate = {
  /** Show the enabled "New VS Code Tab" entry (searchable + static menu). */
  hasNewVSCode: boolean
  /** mac/linux + remote worktree: show a disabled entry with an explanatory
   *  tooltip (never added to the searchable options list). */
  vscodeRemoteDisabled: boolean
}

// VS Code (code-server) only runs against local checkouts on mac/linux; the
// platform + local-host checks are load-bearing (SSH/remote case included).
// Gating on the callback's presence too: surfaces without a real local
// checkout (e.g. the floating terminal) omit it.
export function resolveVSCodeTabCreateGate({
  terminalOnly,
  isLocalWorktree,
  hasCreateCallback
}: {
  terminalOnly: boolean
  isLocalWorktree: boolean
  hasCreateCallback: boolean
}): VSCodeTabCreateGate {
  const platformSupported =
    getRendererAppPlatform() === 'darwin' || getRendererAppPlatform() === 'linux'
  return {
    hasNewVSCode: !terminalOnly && platformSupported && isLocalWorktree && hasCreateCallback,
    vscodeRemoteDisabled: !terminalOnly && platformSupported && !isLocalWorktree && hasCreateCallback
  }
}
