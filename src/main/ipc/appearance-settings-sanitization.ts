import type { GlobalSettings } from '../../shared/global-settings-types'
import { normalizeTerminalCustomThemes } from '../../shared/terminal-custom-themes'
import { normalizeDesktopTerminalScrollbackRows } from '../../shared/terminal-scrollback-policy'
import { normalizeTerminalLineHeight } from '../../shared/terminal-line-height-settings'
import { normalizeEditorFontSize } from '../../shared/editor-font-size'

/** Terminal and editor appearance fields, clamped to the values the UI can render. */
export function sanitizeAppearanceSettings(
  args: Partial<GlobalSettings>,
  sanitized: Partial<GlobalSettings>
): void {
  if ('terminalCustomThemes' in args) {
    sanitized.terminalCustomThemes = normalizeTerminalCustomThemes(args.terminalCustomThemes)
  }
  if ('terminalScrollbackRows' in args) {
    sanitized.terminalScrollbackRows = normalizeDesktopTerminalScrollbackRows(
      args.terminalScrollbackRows
    )
  }
  if ('terminalLineHeight' in args) {
    sanitized.terminalLineHeight = normalizeTerminalLineHeight(args.terminalLineHeight)
  }
  if ('editorFontSize' in args) {
    sanitized.editorFontSize = normalizeEditorFontSize(args.editorFontSize)
  }
}
