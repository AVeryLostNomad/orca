import type { ITheme } from '@xterm/xterm'
import { compositeOver, parseHex, toHex, type AppThemeSource } from './app-theme-token-map'

/** Terminal colors derived from the active app theme; terminals prefer this over the selected terminal theme. */
export type AppThemeTerminalTheme = {
  mode: 'dark' | 'light'
  appThemeId: string
  theme: ITheme
}

type AnsiSlot = keyof Pick<
  ITheme,
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'brightBlack'
  | 'brightRed'
  | 'brightGreen'
  | 'brightYellow'
  | 'brightBlue'
  | 'brightMagenta'
  | 'brightCyan'
  | 'brightWhite'
>

const ANSI_SLOTS: [AnsiSlot, string][] = [
  ['black', 'terminal.ansiBlack'],
  ['red', 'terminal.ansiRed'],
  ['green', 'terminal.ansiGreen'],
  ['yellow', 'terminal.ansiYellow'],
  ['blue', 'terminal.ansiBlue'],
  ['magenta', 'terminal.ansiMagenta'],
  ['cyan', 'terminal.ansiCyan'],
  ['white', 'terminal.ansiWhite'],
  ['brightBlack', 'terminal.ansiBrightBlack'],
  ['brightRed', 'terminal.ansiBrightRed'],
  ['brightGreen', 'terminal.ansiBrightGreen'],
  ['brightYellow', 'terminal.ansiBrightYellow'],
  ['brightBlue', 'terminal.ansiBrightBlue'],
  ['brightMagenta', 'terminal.ansiBrightMagenta'],
  ['brightCyan', 'terminal.ansiBrightCyan'],
  ['brightWhite', 'terminal.ansiBrightWhite']
]

/** Maps a VS Code theme's terminal colors (editor colors as fallback) onto an
 *  xterm theme. ANSI slots absent from the theme stay unset so xterm's
 *  defaults plus minimum-contrast correction keep output legible. */
export function buildAppThemeTerminalTheme(source: AppThemeSource): ITheme | null {
  const colors = source.colors ?? {}
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      if (parseHex(colors[key])) {
        return colors[key]
      }
    }
    return undefined
  }

  const editorBg = parseHex(pick('editor.background') ?? source.bg)
  const rawBg = parseHex(pick('terminal.background')) ?? editorBg
  const foreground =
    pick('terminal.foreground', 'editor.foreground', 'foreground') ??
    (parseHex(source.fg) ? source.fg : undefined)
  if (!rawBg || !foreground) {
    return null
  }
  // Opaque hex: composeActiveTerminalTheme's opacity conversion and pane chrome expect a 6-digit background.
  const opaqueBase =
    editorBg && editorBg.a >= 1
      ? editorBg
      : source.type === 'dark'
        ? { r: 0, g: 0, b: 0, a: 1 }
        : { r: 255, g: 255, b: 255, a: 1 }
  const background = toHex(rawBg.a >= 1 ? rawBg : compositeOver(rawBg, opaqueBase))

  const theme: ITheme = { background, foreground }
  const cursor = pick('terminalCursor.foreground')
  if (cursor) {
    theme.cursor = cursor
  }
  const cursorAccent = pick('terminalCursor.background')
  if (cursorAccent) {
    theme.cursorAccent = cursorAccent
  }
  const selectionBackground = pick('terminal.selectionBackground', 'editor.selectionBackground')
  if (selectionBackground) {
    theme.selectionBackground = selectionBackground
  }
  const selectionInactiveBackground = pick('terminal.inactiveSelectionBackground')
  if (selectionInactiveBackground) {
    theme.selectionInactiveBackground = selectionInactiveBackground
  }
  const selectionForeground = pick('terminal.selectionForeground')
  if (selectionForeground) {
    theme.selectionForeground = selectionForeground
  }
  for (const [slot, key] of ANSI_SLOTS) {
    const value = pick(key)
    if (value) {
      theme[slot] = value
    }
  }
  return theme
}
