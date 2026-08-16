import { webContents } from 'electron'
import type { KeybindingOverrides } from '../../shared/keybindings'
import { BROWSER_PAGE_ZOOM_STEP } from '../../shared/browser-page-zoom'
import { setupGuestShortcutForwarding } from '../browser/browser-guest-shortcut-forwarding'
import type { ShouldForwardDictationShortcut } from '../browser/browser-guest-shortcut-dispatch'

type RegisteredCodeServerGuest = { webContentsId: number; cleanup: () => void }

const registeredGuests = new Map<string, RegisteredCodeServerGuest>()

// Installs Orca shortcut forwarding on a code-server <webview> guest. The guest
// is its own Chromium process, so without this no Orca chord fires while the
// embedded editor has focus. Forwarding runs in the 'vscode' keybinding context:
// only allowInVsCode-marked actions forward; everything else stays with VS Code.
export function registerCodeServerGuest(args: {
  codeServerTabId: string
  guest: Electron.WebContents
  rendererWebContentsId: number
  getKeybindings?: () => KeybindingOverrides | undefined
  shouldForwardDictationShortcut?: ShouldForwardDictationShortcut
}): void {
  const { codeServerTabId, guest, rendererWebContentsId } = args
  // Why: a renderer-process swap re-registers the same tab id with a new guest.
  unregisterCodeServerGuest(codeServerTabId)

  const resolveRenderer = (): Electron.WebContents | null => {
    const renderer = webContents.fromId(rendererWebContentsId)
    return renderer && !renderer.isDestroyed() ? renderer : null
  }
  const removeForwarding = setupGuestShortcutForwarding({
    browserTabId: codeServerTabId,
    guest,
    context: 'vscode',
    resolveRenderer,
    getKeybindings: args.getKeybindings,
    shouldForwardDictationShortcut: args.shouldForwardDictationShortcut,
    // Why: code-server tabs have no renderer-side browser-zoom state; apply zoom on the guest here.
    forwardPageZoom: (event, direction) => {
      event.preventDefault()
      if (guest.isDestroyed()) {
        return
      }
      if (direction === 'reset') {
        guest.setZoomLevel(0)
        return
      }
      const step = direction === 'in' ? BROWSER_PAGE_ZOOM_STEP : -BROWSER_PAGE_ZOOM_STEP
      guest.setZoomLevel(guest.getZoomLevel() + step)
    }
  })
  const onDestroyed = (): void => unregisterCodeServerGuest(codeServerTabId)
  guest.once('destroyed', onDestroyed)
  registeredGuests.set(codeServerTabId, {
    webContentsId: guest.id,
    cleanup: () => {
      removeForwarding()
      try {
        guest.off('destroyed', onDestroyed)
      } catch {
        // Why: best-effort — guest may already be destroyed during teardown.
      }
    }
  })
}

export function unregisterCodeServerGuest(codeServerTabId: string): void {
  const entry = registeredGuests.get(codeServerTabId)
  if (!entry) {
    return
  }
  registeredGuests.delete(codeServerTabId)
  entry.cleanup()
}

export function disposeAllCodeServerGuests(): void {
  for (const codeServerTabId of registeredGuests.keys()) {
    unregisterCodeServerGuest(codeServerTabId)
  }
}
