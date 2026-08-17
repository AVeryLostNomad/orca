import type { CSSProperties } from 'react'
import { useAppStore } from '@/store'
import { computeDiffEditorFontSize, resolveEditorFontFamily } from '@/lib/editor-font-zoom'

export type PierreDiffThemeType = 'dark' | 'light'

// Why: fonts like "SF Mono" resolve in Monaco (it appends its own monospace
// fallbacks) but not in Chromium CSS, where a miss falls through to the serif
// default. Append the same class of fallbacks so the diff degrades to monospace.
const PIERRE_DIFF_FONT_FALLBACK =
  'Menlo, Monaco, Consolas, "Droid Sans Mono", "Courier New", monospace'

export function usePierreDiffThemeType(): PierreDiffThemeType {
  const theme = useAppStore((s) => s.settings?.theme)
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  return isDark ? 'dark' : 'light'
}

/**
 * Host-element CSS variables the diffs web component reads through its shadow
 * boundary. Backgrounds track `--editor-surface` so diff panes match Monaco.
 */
export function usePierreDiffStyleVars(): CSSProperties {
  const settings = useAppStore((s) => s.settings)
  const editorFontZoomLevel = useAppStore((s) => s.editorFontZoomLevel)
  const terminalFontSize = settings?.terminalFontSize ?? 13
  const fontSize = computeDiffEditorFontSize(terminalFontSize, editorFontZoomLevel)
  return {
    '--diffs-font-family': `${resolveEditorFontFamily(settings)}, ${PIERRE_DIFF_FONT_FALLBACK}`,
    '--diffs-font-size': `${fontSize}px`,
    '--diffs-line-height': `${Math.round(fontSize * 1.5)}px`,
    '--diffs-light-bg': 'var(--editor-surface)',
    '--diffs-dark-bg': 'var(--editor-surface)'
  } as CSSProperties
}
