import { describe, expect, it } from 'vitest'
import { resolveVSCodeTabCreateGate } from './vscode-tab-create-gate'

const base = { terminalOnly: false, isLocalWorktree: true, hasCreateCallback: true }

describe('resolveVSCodeTabCreateGate', () => {
  it('offers the tab when the editor is supported for a local worktree', () => {
    expect(resolveVSCodeTabCreateGate({ ...base, editorSupported: true })).toEqual({
      hasNewVSCode: true,
      vscodeRemoteDisabled: false
    })
  })

  it('shows the disabled remote entry when the worktree is not local', () => {
    expect(
      resolveVSCodeTabCreateGate({ ...base, isLocalWorktree: false, editorSupported: true })
    ).toEqual({ hasNewVSCode: false, vscodeRemoteDisabled: true })
  })

  it('offers nothing when the editor capability is absent (web client)', () => {
    expect(resolveVSCodeTabCreateGate({ ...base, editorSupported: false })).toEqual({
      hasNewVSCode: false,
      vscodeRemoteDisabled: false
    })
  })

  it('hides both entries when the new-tab-menu setting turns VS Code off', () => {
    expect(
      resolveVSCodeTabCreateGate({ ...base, settingEnabled: false, editorSupported: true })
    ).toEqual({ hasNewVSCode: false, vscodeRemoteDisabled: false })
    // The remote disabled-with-tooltip row vanishes too, not just the live entry.
    expect(
      resolveVSCodeTabCreateGate({
        ...base,
        isLocalWorktree: false,
        settingEnabled: false,
        editorSupported: true
      })
    ).toEqual({ hasNewVSCode: false, vscodeRemoteDisabled: false })
  })

  it('offers nothing for terminal-only surfaces or without a create callback', () => {
    expect(
      resolveVSCodeTabCreateGate({ ...base, terminalOnly: true, editorSupported: true })
    ).toEqual({ hasNewVSCode: false, vscodeRemoteDisabled: false })
    expect(
      resolveVSCodeTabCreateGate({ ...base, hasCreateCallback: false, editorSupported: true })
    ).toEqual({ hasNewVSCode: false, vscodeRemoteDisabled: false })
  })
})
