import { ORCA_BROWSER_GUEST_WEB_PREFERENCES_ATTRIBUTE } from '../../../../shared/browser-guest-web-preferences'
import { normalizeCodeServerPathParam } from '../code-server-pane/code-server-webview'

// Keyed by data-studio tab id, so the pane can re-attach the same guest
// element across re-renders. The guest is destroyed when the tab's pane
// unmounts (tab close) — persistence across tab switches instead depends on
// the pane staying mounted while its tab is open (a mount-strategy concern
// owned by the tab host, not this registry).
const dataStudioWebviewRegistry = new Map<string, Electron.WebviewTag>()

// Same ?folder= contract as code-server: a raw `C:\...` path parses its drive
// letter as the URI scheme, no file system provider matches, the workspace
// turns "virtual", and every virtualWorkspaces:false extension (mssql and most
// ADS builtins) is silently disabled — connections then show "Unsupported".
export function buildDataStudioUrl(port: number, folderPath: string): string {
  return `http://127.0.0.1:${port}/?folder=${encodeURIComponent(normalizeCodeServerPathParam(folderPath))}`
}

export function ensureDataStudioWebview({
  dataStudioTabId,
  container,
  partition
}: {
  dataStudioTabId: string
  container: HTMLDivElement
  // Per-repo partition from dataStudio:ensureRunning — the workbench's secret
  // storage (saved DB passwords) lives in the guest's browser storage, so each
  // repo gets its own bucket.
  partition: string
}): { webview: Electron.WebviewTag; created: boolean } | null {
  const existing = dataStudioWebviewRegistry.get(dataStudioTabId)
  if (existing && existing.parentElement === container) {
    return { webview: existing, created: false }
  }
  if (existing) {
    existing.remove()
    dataStudioWebviewRegistry.delete(dataStudioTabId)
  }
  const webview = document.createElement('webview') as Electron.WebviewTag
  webview.setAttribute('partition', partition)
  webview.setAttribute('allowpopups', '')
  webview.setAttribute('webpreferences', ORCA_BROWSER_GUEST_WEB_PREFERENCES_ATTRIBUTE)
  webview.style.display = 'flex'
  webview.style.flex = '1'
  webview.style.width = '100%'
  webview.style.height = '100%'
  webview.style.border = 'none'
  // Match the workbench's own surface so no Orca chrome leaks before first paint.
  webview.style.background = '#1e1e1e'
  // Why: the guest is its own WebContents — Orca chords only work while it has
  // focus once main installs before-input-event forwarding on it. The Data
  // Studio guest is the same workbench UI as the editor, so it reuses the
  // codeServer guest registration (and the 'vscode' keybinding context).
  let lastRegisteredWebContentsId: number | null = null
  const registerGuest = (): void => {
    let webContentsId: number
    try {
      webContentsId = webview.getWebContentsId()
    } catch {
      return // not attached yet
    }
    if (webContentsId === lastRegisteredWebContentsId) {
      return
    }
    lastRegisteredWebContentsId = webContentsId
    void window.api.codeServer.registerGuest({ codeServerTabId: dataStudioTabId, webContentsId })
  }
  webview.addEventListener('did-attach', registerGuest)
  // Why: a guest renderer-process swap keeps the element but changes its webContents; re-register.
  webview.addEventListener('dom-ready', registerGuest)
  dataStudioWebviewRegistry.set(dataStudioTabId, webview)
  container.appendChild(webview)
  return { webview, created: true }
}

export function destroyDataStudioWebview(dataStudioTabId: string): void {
  const webview = dataStudioWebviewRegistry.get(dataStudioTabId)
  if (webview) {
    webview.remove()
    dataStudioWebviewRegistry.delete(dataStudioTabId)
    void window.api.codeServer.unregisterGuest({ codeServerTabId: dataStudioTabId })
  }
}
