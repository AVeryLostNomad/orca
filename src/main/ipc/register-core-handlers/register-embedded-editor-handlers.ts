import type { KeybindingService } from '../../keybindings/keybinding-service'
import { registerCodeServerHandlers } from '../code-server'
import { registerDataStudioHandlers } from '../data-studio'
import { registerEditorThemeHandlers } from '../editor-themes'
import { registerLspHandlers } from '../lsp'
import { registerUnityHandlers } from '../unity'

/** Embedded VS Code, Data Studio, editor themes, language servers and Unity integration. */
export function registerEmbeddedEditorHandlers(keybindings?: KeybindingService): void {
  registerCodeServerHandlers({ getKeybindings: () => keybindings?.getOverrides() })
  registerDataStudioHandlers()
  registerEditorThemeHandlers()
  registerLspHandlers()
  registerUnityHandlers()
}
