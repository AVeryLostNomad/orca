import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveEditorExtensionsDir, resolveEditorUserDir } from './code-server-import-sources'

const HOME = join('C:\\Users', 'First Last')
const APPDATA = join(HOME, 'AppData', 'Roaming')
const deps = { platform: 'win32' as const, env: { APPDATA }, homeDir: HOME }

describe('editor import source paths on win32', () => {
  it('resolves each editor User dir under %APPDATA%', () => {
    expect(resolveEditorUserDir('vscode', deps)).toBe(join(APPDATA, 'Code', 'User'))
    expect(resolveEditorUserDir('vscode-insiders', deps)).toBe(
      join(APPDATA, 'Code - Insiders', 'User')
    )
    expect(resolveEditorUserDir('vscodium', deps)).toBe(join(APPDATA, 'VSCodium', 'User'))
    expect(resolveEditorUserDir('cursor', deps)).toBe(join(APPDATA, 'Cursor', 'User'))
  })

  it('falls back to <home>\\AppData\\Roaming when APPDATA is unset', () => {
    expect(resolveEditorUserDir('vscode', { platform: 'win32', env: {}, homeDir: HOME })).toBe(
      join(APPDATA, 'Code', 'User')
    )
  })

  it('resolves extensions dirs home-relative (%USERPROFILE%\\.vscode\\extensions)', () => {
    expect(resolveEditorExtensionsDir('vscode', deps)).toBe(join(HOME, '.vscode', 'extensions'))
    expect(resolveEditorExtensionsDir('cursor', deps)).toBe(join(HOME, '.cursor', 'extensions'))
  })

  it('still returns null on unsupported platforms', () => {
    expect(resolveEditorUserDir('vscode', { platform: 'freebsd', homeDir: HOME })).toBeNull()
    expect(resolveEditorExtensionsDir('vscode', { platform: 'freebsd', homeDir: HOME })).toBeNull()
  })
})
