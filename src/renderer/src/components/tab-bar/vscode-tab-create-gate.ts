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
// floating terminal) omit it.
export function resolveVSCodeTabCreateGate({
  terminalOnly,
  isLocalWorktree,
  hasCreateCallback,
  editorSupported = isEmbeddedEditorSupported()
}: {
  terminalOnly: boolean
  isLocalWorktree: boolean
  hasCreateCallback: boolean
  editorSupported?: boolean
}): VSCodeTabCreateGate {
  return {
    hasNewVSCode: !terminalOnly && editorSupported && isLocalWorktree && hasCreateCallback,
    vscodeRemoteDisabled: !terminalOnly && editorSupported && !isLocalWorktree && hasCreateCallback
  }
}
