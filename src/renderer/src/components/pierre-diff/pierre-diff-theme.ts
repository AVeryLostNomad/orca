import type { CSSProperties } from 'react'
import { useMemo } from 'react'
import { registerCustomTheme, type ThemeRegistration, type ThemesType } from '@pierre/diffs'
import { useAppStore } from '@/store'
import {
  computeDiffEditorFontSize,
  resolveEditorBaseFontSize,
  resolveEditorFontFamily
} from '@/lib/editor-font-zoom'
import { useSystemPrefersDark } from '../terminal-pane/use-system-prefers-dark'
import {
  DEFAULT_EDITOR_THEME_DARK,
  DEFAULT_EDITOR_THEME_LIGHT,
  decodeLocalEditorThemeId,
  getBundledEditorTheme,
  isLocalEditorThemeId,
  monacoThemeNameForEditorTheme
} from '@/lib/monaco-highlighting/editor-theme-catalog'

export type PierreDiffThemeType = 'dark' | 'light'

// Pierre's generated shadow-root CSS defines these after inherited host
// variables. `unsafeCSS` inserts this override after that generated theme.
export const PIERRE_EDITOR_SURFACE_UNSAFE_CSS = `
:host {
  --diffs-dark-bg: var(--editor-surface);
  --diffs-light-bg: var(--editor-surface);
}
`

const registeredLocalPierreThemes = new Set<string>()

/**
 * Maps an editor theme id to a name Pierre's resolver accepts. Bundled shiki
 * ids and pierre-* ids resolve natively; local VS Code themes register a
 * lazy loader once under the same stable slug Monaco uses.
 */
function pierreThemeName(id: string, kind: PierreDiffThemeType): string {
  if (!isLocalEditorThemeId(id)) {
    // Why: an unknown id (removed bundled theme) must not reach Pierre's
    // resolver, which would reject the whole render.
    return getBundledEditorTheme(id)
      ? id
      : kind === 'dark'
        ? DEFAULT_EDITOR_THEME_DARK
        : DEFAULT_EDITOR_THEME_LIGHT
  }
  const slug = monacoThemeNameForEditorTheme(id)
  if (!registeredLocalPierreThemes.has(slug)) {
    registeredLocalPierreThemes.add(slug)
    registerCustomTheme(slug, async () => {
      try {
        const localId = decodeLocalEditorThemeId(id)
        if (!localId) {
          throw new Error(`Malformed local editor theme id: ${id}`)
        }
        const theme = await window.api.editorThemes.read(localId)
        return {
          ...theme,
          name: slug,
          // Why: entries without settings are legal theme JSON but violate
          // shiki's normalized shape (mirrors editor-theme-controller).
          tokenColors: (theme.tokenColors ?? []).filter((entry) => entry.settings)
        } as ThemeRegistration
      } catch {
        // Theme uninstalled since selection: a neutral registration keeps the
        // diff rendering; Monaco separately falls back to its bundled default.
        return { name: slug, type: kind, colors: {}, settings: [] } as ThemeRegistration
      }
    })
  }
  return slug
}

/** Dual syntax-theme names for FileDiffOptions.theme — follows the editor theme. */
export function usePierreSyntaxTheme(): ThemesType {
  const editorThemeLight = useAppStore((s) => s.settings?.editorThemeLight)
  const editorThemeDark = useAppStore((s) => s.settings?.editorThemeDark)
  const light = editorThemeLight || DEFAULT_EDITOR_THEME_LIGHT
  const dark = editorThemeDark || DEFAULT_EDITOR_THEME_DARK
  return useMemo(
    () => ({ light: pierreThemeName(light, 'light'), dark: pierreThemeName(dark, 'dark') }),
    [light, dark]
  )
}

// Why: fonts like "SF Mono" resolve in Monaco (it appends its own monospace
// fallbacks) but not in Chromium CSS, where a miss falls through to the serif
// default. Append the same class of fallbacks so the diff degrades to monospace.
const PIERRE_DIFF_FONT_FALLBACK =
  'Menlo, Monaco, Consolas, "Droid Sans Mono", "Courier New", monospace'

export function usePierreDiffThemeType(): PierreDiffThemeType {
  const theme = useAppStore((s) => s.settings?.theme) ?? 'system'
  const systemPrefersDark = useSystemPrefersDark()
  return theme === 'dark' || (theme === 'system' && systemPrefersDark) ? 'dark' : 'light'
}

/** Host-element CSS variables for the diff's font metrics. */
export function usePierreDiffStyleVars(): CSSProperties {
  const settings = useAppStore((s) => s.settings)
  const editorFontZoomLevel = useAppStore((s) => s.editorFontZoomLevel)
  const baseFontSize = resolveEditorBaseFontSize(settings)
  const fontSize = computeDiffEditorFontSize(baseFontSize, editorFontZoomLevel)
  return {
    '--diffs-font-family': `${resolveEditorFontFamily(settings)}, ${PIERRE_DIFF_FONT_FALLBACK}`,
    '--diffs-font-size': `${fontSize}px`,
    '--diffs-line-height': `${Math.round(fontSize * 1.5)}px`
  } as CSSProperties
}
