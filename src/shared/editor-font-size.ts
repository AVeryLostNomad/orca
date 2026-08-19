export const EDITOR_FONT_SIZE_MIN = 8
export const EDITOR_FONT_SIZE_MAX = 32

/**
 * Why: the renderer writes user-typed input; anything non-numeric or absurd
 * must collapse to "unset" (follow terminal font size) rather than persist.
 */
export function normalizeEditorFontSize(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }
  const rounded = Math.round(value)
  return Math.max(EDITOR_FONT_SIZE_MIN, Math.min(EDITOR_FONT_SIZE_MAX, rounded))
}
