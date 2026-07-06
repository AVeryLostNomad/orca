import { ORCA_BROWSER_GUEST_WEB_PREFERENCES_ATTRIBUTE } from '../../../../shared/browser-guest-web-preferences'
import { ORCA_VSCODE_PARTITION } from '../../../../shared/constants'

// Keyed by code-server tab id — keeps the guest alive across tab switches so
// editor state survives (like the browser registry, but code-server-scoped).
const codeServerWebviewRegistry = new Map<string, Electron.WebviewTag>()

export function buildCodeServerUrl(port: number, folderPath: string): string {
  return `http://127.0.0.1:${port}/?folder=${encodeURIComponent(folderPath)}`
}

export function ensureCodeServerWebview({
  codeServerTabId,
  container
}: {
  codeServerTabId: string
  container: HTMLDivElement
}): { webview: Electron.WebviewTag; created: boolean } | null {
  const existing = codeServerWebviewRegistry.get(codeServerTabId)
  if (existing && existing.parentElement === container) {
    return { webview: existing, created: false }
  }
  if (existing) {
    existing.remove()
    codeServerWebviewRegistry.delete(codeServerTabId)
  }
  const webview = document.createElement('webview') as Electron.WebviewTag
  webview.setAttribute('partition', ORCA_VSCODE_PARTITION)
  webview.setAttribute('allowpopups', '')
  webview.setAttribute('webpreferences', ORCA_BROWSER_GUEST_WEB_PREFERENCES_ATTRIBUTE)
  webview.style.display = 'flex'
  webview.style.flex = '1'
  webview.style.width = '100%'
  webview.style.height = '100%'
  webview.style.border = 'none'
  // Match VS Code's own surface so no Orca chrome leaks before first paint.
  webview.style.background = '#1e1e1e'
  codeServerWebviewRegistry.set(codeServerTabId, webview)
  container.appendChild(webview)
  return { webview, created: true }
}

export function destroyCodeServerWebview(codeServerTabId: string): void {
  const webview = codeServerWebviewRegistry.get(codeServerTabId)
  if (webview) {
    webview.remove()
    codeServerWebviewRegistry.delete(codeServerTabId)
  }
}
