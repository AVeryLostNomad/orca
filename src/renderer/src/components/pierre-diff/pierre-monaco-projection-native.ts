const ACTIVE_ATTRIBUTE = 'data-pierre-monaco-projection-active'
const NATIVE_TEXT_STYLE_ATTRIBUTE = 'data-pierre-monaco-projection-native-text'
const OVERLAY_CLASS = 'pierre-monaco-projection'

const overlayStyles = `
.${OVERLAY_CLASS} {
  position: absolute;
  z-index: 2;
  pointer-events: none;
  overflow: visible;
}
.${OVERLAY_CLASS}:has(.action-widget :focus),
.${OVERLAY_CLASS}:has(.quick-input-widget :focus) {
  z-index: 50;
}
.${OVERLAY_CLASS} .monaco-editor,
.${OVERLAY_CLASS} .monaco-editor-background,
.${OVERLAY_CLASS} .monaco-editor .margin {
  background-color: transparent !important;
}
.${OVERLAY_CLASS} .monaco-editor .view-lines .view-line,
.${OVERLAY_CLASS} .monaco-editor .contentWidgets,
.${OVERLAY_CLASS} .monaco-editor .contentWidgets *,
.${OVERLAY_CLASS} .monaco-editor .overlayWidgets,
.${OVERLAY_CLASS} .monaco-editor .overlayWidgets *,
.${OVERLAY_CLASS} .monaco-editor .suggest-widget,
.${OVERLAY_CLASS} .monaco-editor .suggest-widget *,
.${OVERLAY_CLASS} .quick-input-widget,
.${OVERLAY_CLASS} .quick-input-widget *,
.${OVERLAY_CLASS} .monaco-editor textarea.inputarea {
  pointer-events: auto;
}
`

const nativeTextStyles = `
:host([${ACTIVE_ATTRIBUTE}]) [data-code][data-additions] [data-content] > [data-line],
:host([${ACTIVE_ATTRIBUTE}]) [data-code][data-additions] [data-content] > [data-line] *,
:host([${ACTIVE_ATTRIBUTE}]) [data-code][data-unified] [data-content] > [data-line]:not([data-line-type="change-deletion"]),
:host([${ACTIVE_ATTRIBUTE}]) [data-code][data-unified] [data-content] > [data-line]:not([data-line-type="change-deletion"]) * {
  color: transparent !important;
  text-shadow: none !important;
}
/* The overlay (z-index 2) shares this stacking context; rows must scroll under the header. */
:host([${ACTIVE_ATTRIBUTE}]) [data-diffs-header][data-sticky] {
  z-index: 3;
}
`

type NativeEditorAttributes = {
  ariaHidden: string | null
  contentEditable: string | null
  tabIndex: string | null
}

export function installPierreNativeOverlay(
  host: HTMLElement,
  root: ShadowRoot | HTMLElement,
  container: HTMLElement
): { disableNativeEditor: () => void; restoreNativeEditor: () => void; cleanup: () => void } {
  const nativeEditorAttributes = new Map<HTMLElement, NativeEditorAttributes>()
  const nativeStyle = document.createElement('style')
  nativeStyle.setAttribute(NATIVE_TEXT_STYLE_ATTRIBUTE, '')
  nativeStyle.textContent = nativeTextStyles
  root.append(nativeStyle)
  const overlayStyle = document.createElement('style')
  overlayStyle.textContent = overlayStyles
  container.prepend(overlayStyle)
  container.classList.add(OVERLAY_CLASS)

  const restoreNativeEditor = (): void => {
    host.removeAttribute(ACTIVE_ATTRIBUTE)
    for (const [element, attributes] of nativeEditorAttributes) {
      if (attributes.contentEditable === null) {
        element.removeAttribute('contenteditable')
      } else {
        element.setAttribute('contenteditable', attributes.contentEditable)
      }
      if (attributes.ariaHidden === null) {
        element.removeAttribute('aria-hidden')
      } else {
        element.setAttribute('aria-hidden', attributes.ariaHidden)
      }
      if (attributes.tabIndex === null) {
        element.removeAttribute('tabindex')
      } else {
        element.setAttribute('tabindex', attributes.tabIndex)
      }
    }
    nativeEditorAttributes.clear()
  }

  return {
    disableNativeEditor: () => {
      for (const element of root.querySelectorAll<HTMLElement>(
        '[data-code] [data-content][contenteditable="true"]'
      )) {
        if (!nativeEditorAttributes.has(element)) {
          nativeEditorAttributes.set(element, {
            contentEditable: element.getAttribute('contenteditable'),
            ariaHidden: element.getAttribute('aria-hidden'),
            tabIndex: element.getAttribute('tabindex')
          })
        }
        element.setAttribute('contenteditable', 'false')
        element.setAttribute('aria-hidden', 'true')
        element.setAttribute('tabindex', '-1')
      }
      // Runs every reconcile; a redundant write restyles every native row via :host([...]).
      if (!host.hasAttribute(ACTIVE_ATTRIBUTE)) {
        host.setAttribute(ACTIVE_ATTRIBUTE, '')
      }
    },
    restoreNativeEditor,
    cleanup: () => {
      restoreNativeEditor()
      nativeStyle.remove()
      overlayStyle.remove()
      container.classList.remove(OVERLAY_CLASS)
    }
  }
}
