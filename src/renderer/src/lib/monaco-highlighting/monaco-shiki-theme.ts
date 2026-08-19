import type * as Monaco from 'monaco-editor'
import type { ThemeRegistrationResolved } from '@shikijs/core'
import { getShikiHighlighter } from './shiki-highlighter'
import { synthesizeSemanticTokenThemeRules } from './semantic-token-theme-rules'

type MonacoModule = typeof Monaco

// Shared state read by every shiki tokens provider: the active theme's color
// map plus a reverse color→scope index. Providers emit, for each token, a
// TextMate scope from the *converted theme's own rules* that resolves to the
// token's exact color — routing full scope-stack fidelity through Monaco's
// single-scope theme matching.
export type MonacoShikiThemeApplication = {
  colorMap: string[]
  scopeByColorStyle: Map<string, string>
}

const currentApplication: MonacoShikiThemeApplication = {
  colorMap: [],
  scopeByColorStyle: new Map()
}

export function getMonacoShikiThemeApplication(): MonacoShikiThemeApplication {
  return currentApplication
}

export function isMonacoShikiThemeApplied(): boolean {
  return currentApplication.colorMap.length > 0
}

export function normalizeThemeColor(color: string | string[] | undefined): string | undefined {
  let value = Array.isArray(color) ? color[0] : color
  if (!value) {
    return undefined
  }
  value = (value.charCodeAt(0) === 35 ? value.slice(1) : value).toLowerCase()
  if (value.length === 3 || value.length === 4) {
    value = value
      .split('')
      .map((char) => char + char)
      .join('')
  }
  return value
}

const FONT_STYLE_ORDER = ['italic', 'bold', 'underline', 'strikethrough'] as const
const FONT_STYLE_ALIASES: Record<string, string> = { 'line-through': 'strikethrough' }

export function normalizeThemeFontStyle(fontStyle: string | undefined): string {
  if (!fontStyle) {
    return ''
  }
  const styles = new Set(
    fontStyle
      .split(/[\s,]+/)
      .map((style) => style.trim().toLowerCase())
      .map((style) => FONT_STYLE_ALIASES[style] ?? style)
      .filter(Boolean)
  )
  return FONT_STYLE_ORDER.filter((style) => styles.has(style)).join(' ')
}

export function colorStyleKey(color: string, fontStyle: string): string {
  return fontStyle ? `${color}|${fontStyle}` : color
}

export function convertShikiThemeToMonaco(
  theme: ThemeRegistrationResolved
): Monaco.editor.IStandaloneThemeData {
  const rules: Monaco.editor.ITokenThemeRule[] = []
  let globalForeground: string | undefined
  let globalBackground: string | undefined
  for (const setting of theme.settings ?? []) {
    const { foreground, background, fontStyle } = setting.settings ?? {}
    if (!setting.scope) {
      globalForeground ??= normalizeThemeColor(foreground)
      globalBackground ??= normalizeThemeColor(background)
      continue
    }
    if (!foreground && !background && !fontStyle) {
      continue
    }
    const scopes = Array.isArray(setting.scope) ? setting.scope : [setting.scope]
    const normalizedForeground = normalizeThemeColor(foreground)
    const normalizedBackground = normalizeThemeColor(background)
    const normalizedFontStyle = normalizeThemeFontStyle(fontStyle)
    for (const scope of scopes) {
      rules.push({
        token: scope,
        foreground: normalizedForeground,
        background: normalizedBackground,
        fontStyle: normalizedFontStyle || undefined
      })
    }
  }
  rules.push(
    ...synthesizeSemanticTokenThemeRules(theme, normalizeThemeColor, normalizeThemeFontStyle)
  )

  const colors: Monaco.editor.IColors = {}
  for (const [key, value] of Object.entries(theme.colors ?? {})) {
    const normalized = normalizeThemeColor(value)
    if (normalized) {
      colors[key] = `#${normalized}`
    }
  }
  // Why: with inherit:false Monaco falls back to `vs` defaults for any missing
  // editor color; a dark theme without an explicit background would flash white.
  if (!colors['editor.background'] && globalBackground) {
    colors['editor.background'] = `#${globalBackground}`
  }
  if (!colors['editor.foreground'] && globalForeground) {
    colors['editor.foreground'] = `#${globalForeground}`
  }

  return {
    base: theme.type === 'light' ? 'vs' : 'vs-dark',
    inherit: false,
    colors,
    rules
  }
}

export type AppliedMonacoShikiTheme = {
  monacoThemeName: string
  themeData: Monaco.editor.IStandaloneThemeData
}

// Ordering matters: the highlighter's active theme and the reverse color→scope
// index must both be current *before* Monaco retokenizes, so setTheme is last.
export async function applyShikiMonacoTheme(
  monaco: MonacoModule,
  shikiThemeName: string,
  monacoThemeName: string
): Promise<AppliedMonacoShikiTheme> {
  const highlighter = await getShikiHighlighter()
  const { colorMap } = highlighter.setTheme(shikiThemeName)
  const themeData = convertShikiThemeToMonaco(highlighter.getTheme(shikiThemeName))

  currentApplication.colorMap = [...colorMap]
  currentApplication.scopeByColorStyle.clear()
  for (const rule of themeData.rules) {
    const color = normalizeThemeColor(rule.foreground)
    if (!color) {
      continue
    }
    const key = colorStyleKey(color, normalizeThemeFontStyle(rule.fontStyle))
    if (!currentApplication.scopeByColorStyle.has(key)) {
      currentApplication.scopeByColorStyle.set(key, rule.token)
    }
  }

  monaco.editor.defineTheme(monacoThemeName, themeData)
  monaco.editor.setTheme(monacoThemeName)
  return { monacoThemeName, themeData }
}
