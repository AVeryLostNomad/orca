import { isEmbeddedEditorSupported } from '@/lib/embedded-editor-support'

export type VSCodeTabCreateGate = {
  /** Show the enabled "New VS Code Tab" entry (searchable + static menu). */
  hasNewVSCode: boolean
  /** editor supported + remote worktree: show a disabled entry with an
   *  explanatory tooltip (never added to the searchable options list). */
  vscodeRemoteDisabled: boolean
}

// VS Code (code-server) only runs against local checkouts; the capability +
// local-host checks are load-bearing (SSH/remote case included). Gating on the
// callback's presence too: surfaces without a real local checkout (e.g. the
// floating terminal) omit it. A settings opt-out hides both entries entirely —
// no disabled-with-tooltip row — matching how a disabled agent type vanishes.
export function resolveVSCodeTabCreateGate({
  terminalOnly,
  isLocalWorktree,
  hasCreateCallback,
  settingEnabled = true,
  editorSupported = isEmbeddedEditorSupported()
}: {
  terminalOnly: boolean
  isLocalWorktree: boolean
  hasCreateCallback: boolean
  settingEnabled?: boolean
  editorSupported?: boolean
}): VSCodeTabCreateGate {
  const base = !terminalOnly && editorSupported && hasCreateCallback && settingEnabled
  return {
    hasNewVSCode: base && isLocalWorktree,
    vscodeRemoteDisabled: base && !isLocalWorktree
  }
}
