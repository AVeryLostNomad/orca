import { describe, expect, it } from 'vitest'
import { buildAppThemeTerminalTheme } from './app-theme-terminal-theme'

describe('buildAppThemeTerminalTheme', () => {
  it('maps terminal colors, ANSI palette, cursor, and selection', () => {
    const theme = buildAppThemeTerminalTheme({
      type: 'dark',
      colors: {
        'terminal.background': '#1e2127',
        'terminal.foreground': '#abb2bf',
        'terminalCursor.foreground': '#528bff',
        'terminalCursor.background': '#ffffff',
        'terminal.selectionBackground': '#3e4451',
        'terminal.ansiBlack': '#000000',
        'terminal.ansiBrightWhite': '#ffffff'
      }
    })

    expect(theme).toMatchObject({
      background: '#1e2127',
      foreground: '#abb2bf',
      cursor: '#528bff',
      cursorAccent: '#ffffff',
      selectionBackground: '#3e4451',
      black: '#000000',
      brightWhite: '#ffffff'
    })
    // Slots the theme does not define stay unset so xterm defaults apply.
    expect(theme?.red).toBeUndefined()
  })

  it('falls back to editor colors when terminal colors are absent', () => {
    const theme = buildAppThemeTerminalTheme({
      type: 'dark',
      colors: {
        'editor.background': '#282c34',
        'editor.foreground': '#abb2bf',
        'editor.selectionBackground': '#3e4451'
      }
    })

    expect(theme).toMatchObject({
      background: '#282c34',
      foreground: '#abb2bf',
      selectionBackground: '#3e4451'
    })
  })

  it('falls back to shiki top-level bg/fg', () => {
    const theme = buildAppThemeTerminalTheme({ type: 'light', bg: '#ffffff', fg: '#24292e' })

    expect(theme).toMatchObject({ background: '#ffffff', foreground: '#24292e' })
  })

  it('flattens a translucent terminal background to opaque hex', () => {
    const theme = buildAppThemeTerminalTheme({
      type: 'dark',
      colors: {
        'editor.background': '#000000',
        'editor.foreground': '#ffffff',
        'terminal.background': '#ffffff80'
      }
    })

    expect(theme?.background).toMatch(/^#[0-9a-f]{6}$/)
    expect(theme?.background).toBe('#808080')
  })

  it('returns null when the theme has no usable colors', () => {
    expect(buildAppThemeTerminalTheme({ type: 'dark' })).toBeNull()
    expect(buildAppThemeTerminalTheme({ type: 'dark', colors: { foo: 'red' } })).toBeNull()
  })

  it('returns null when only a background exists without any foreground', () => {
    expect(
      buildAppThemeTerminalTheme({ type: 'dark', colors: { 'editor.background': '#111111' } })
    ).toBeNull()
  })
})
