import { describe, expect, it } from 'vitest'
import { toVisibleTabType } from './worktrees'

describe('toVisibleTabType', () => {
  it('passes through vscode so session restore keeps the VS Code surface active', () => {
    // Regression (I2): vscode previously fell into the else branch and restored
    // as 'editor', breaking the last-active-tab parity on app restart.
    expect(toVisibleTabType('vscode')).toBe('vscode')
  })

  it('passes through the other visible tab types', () => {
    expect(toVisibleTabType('terminal')).toBe('terminal')
    expect(toVisibleTabType('browser')).toBe('browser')
    expect(toVisibleTabType('simulator')).toBe('simulator')
  })

  it('maps unknown/editor content types to editor', () => {
    expect(toVisibleTabType('editor')).toBe('editor')
    expect(toVisibleTabType('diff')).toBe('editor')
  })
})
