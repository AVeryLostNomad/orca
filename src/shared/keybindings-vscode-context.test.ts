// The 'vscode' focus context: only allowInVsCode-marked actions fire while the
// embedded VS Code guest owns focus; everything else stays with the editor.
import { describe, expect, it } from 'vitest'
import {
  getKeybindingDefinition,
  KEYBINDING_DEFINITIONS,
  keybindingIsActiveInContext,
  keybindingMatchesAction,
  type KeybindingInput
} from './keybindings'

const vscodeContext = { context: 'vscode' } as const

function chord(key: string, code: string, mods: Partial<KeybindingInput> = {}): KeybindingInput {
  return { key, code, meta: false, control: false, alt: false, shift: false, ...mods }
}

describe('keybindings vscode context', () => {
  it('forwards allowlisted Orca navigation chords', () => {
    expect(
      keybindingMatchesAction(
        'worktree.palette',
        chord('j', 'KeyJ', { meta: true }),
        'darwin',
        undefined,
        vscodeContext
      )
    ).toBe(true)
    expect(
      keybindingMatchesAction(
        'sidebar.left.toggle',
        chord('b', 'KeyB', { meta: true }),
        'darwin',
        undefined,
        vscodeContext
      )
    ).toBe(true)
    expect(
      keybindingMatchesAction(
        'tab.close',
        chord('w', 'KeyW', { meta: true }),
        'darwin',
        undefined,
        vscodeContext
      )
    ).toBe(true)
  })

  it('leaves editor-critical chords with VS Code', () => {
    expect(
      keybindingMatchesAction(
        'worktree.quickOpen',
        chord('p', 'KeyP', { meta: true }),
        'darwin',
        undefined,
        vscodeContext
      )
    ).toBe(false)
    expect(
      keybindingMatchesAction(
        'workspace.create',
        chord('n', 'KeyN', { meta: true }),
        'darwin',
        undefined,
        vscodeContext
      )
    ).toBe(false)
    expect(
      keybindingMatchesAction(
        'browser.find',
        chord('f', 'KeyF', { meta: true }),
        'darwin',
        undefined,
        vscodeContext
      )
    ).toBe(false)
  })

  it('does not change matching without a context', () => {
    expect(
      keybindingMatchesAction('worktree.quickOpen', chord('p', 'KeyP', { meta: true }), 'darwin')
    ).toBe(true)
  })

  it('gates purely on the allowInVsCode flag', () => {
    for (const definition of KEYBINDING_DEFINITIONS) {
      expect(keybindingIsActiveInContext(definition, vscodeContext)).toBe(
        definition.allowInVsCode === true
      )
    }
  })

  it('never marks editor/terminal-scope or browser actions as vscode-allowed', () => {
    const mustStayWithVsCode = [
      'worktree.quickOpen',
      'workspace.create',
      'tab.nextSameType',
      'tab.previousSameType',
      'tab.nextTerminal',
      'tab.previousTerminal',
      'browser.find',
      'browser.reload',
      'browser.focusAddressBar',
      'editor.find',
      'editor.save',
      'terminal.search'
    ] as const
    for (const actionId of mustStayWithVsCode) {
      expect(getKeybindingDefinition(actionId)?.allowInVsCode).toBeUndefined()
    }
  })
})
