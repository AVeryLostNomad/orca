import type { editor } from 'monaco-editor'
import { StandardKeyboardEvent } from 'monaco-editor/esm/vs/base/browser/keyboardEvent.js'
import { StandaloneServices } from 'monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js'
import { IKeybindingService } from 'monaco-editor/esm/vs/platform/keybinding/common/keybinding.js'

export function installPierreMonacoWidgetKeybindings(
  widgetRoot: HTMLElement,
  editorInstance: editor.IStandaloneCodeEditor
): () => void {
  const keybindings = StandaloneServices.get(IKeybindingService)
  const onKeyDown = (event: KeyboardEvent): void => {
    // Standalone Monaco only listens on its editor container, not overflow portals.
    if (
      keybindings.dispatchEvent(
        new StandardKeyboardEvent(event),
        editorInstance.getContainerDomNode()
      )
    ) {
      event.preventDefault()
      event.stopPropagation()
    }
  }
  widgetRoot.addEventListener('keydown', onKeyDown)
  return () => widgetRoot.removeEventListener('keydown', onKeyDown)
}
