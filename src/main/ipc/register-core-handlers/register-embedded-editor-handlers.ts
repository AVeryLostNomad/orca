import type { KeybindingService } from '../../keybindings/keybinding-service'
import { registerCodeServerHandlers } from '../code-server'
import { registerDataStudioHandlers } from '../data-studio'
import { registerEditorThemeHandlers } from '../editor-themes'
import { registerLspHandlers } from '../lsp'

/** Embedded VS Code, Data Studio, editor themes and language servers. */
export function registerEmbeddedEditorHandlers(keybindings?: KeybindingService): void {
  registerCodeServerHandlers({ getKeybindings: () => keybindings?.getOverrides() })
  registerDataStudioHandlers()
  registerEditorThemeHandlers()
  registerLspHandlers()
}
