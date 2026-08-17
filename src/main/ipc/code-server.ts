import { BrowserWindow, ipcMain, webContents } from 'electron'
import type { KeybindingOverrides } from '../../shared/keybindings'
import type {
  CodeServerImportRequest,
  CodeServerImportResult,
  CodeServerImportState,
  CodeServerStatusEvent
} from '../../shared/code-server-types'
import { getCodeServerService } from '../code-server/code-server-service'
import { detectCodeServerImportSources } from '../code-server/code-server-import-sources'
import {
  readCodeServerImportPreference,
  updateCodeServerImportPreference
} from '../code-server/code-server-import-preference'
import { importExtensionsFromEditor } from '../code-server/code-server-extension-import'
import { openFileInCodeServer } from '../code-server/code-server-open-file'
import { mirrorEditorUserConfig } from '../code-server/code-server-editor-user-config'
import {
  registerCodeServerGuest,
  unregisterCodeServerGuest
} from '../code-server/code-server-guest-shortcut-registry'
import { browserManager } from '../browser/browser-manager'

type CodeServerGuestRegistrationArgs = {
  codeServerTabId: string
  webContentsId: number
}

export function registerCodeServerHandlers(options?: {
  getKeybindings?: () => KeybindingOverrides | undefined
}): void {
  const service = getCodeServerService()

  // Broadcast lifecycle changes to every open window's renderer.
  service.onStatusChanged((event: CodeServerStatusEvent) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('codeServer:statusChanged', event)
      }
    }
  })

  ipcMain.handle('codeServer:ensureRunning', async () => {
    try {
      return await service.acquire()
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  })

  // Non-refcounting re-drive for the pane's Retry button; acquire already ran on
  // mount, so retrying must not take a second ref (see CodeServerManager.retry).
  ipcMain.handle('codeServer:retry', async () => {
    try {
      return await service.retry()
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('codeServer:release', () => {
    service.release()
  })

  ipcMain.handle('codeServer:getStatus', () => service.getStatus())

  // Best-effort open in the running workbench session; false → caller falls
  // back to Orca's own editor.
  ipcMain.handle('codeServer:openFile', async (_event, args: { path: string }) => {
    if (typeof args?.path !== 'string' || args.path.length === 0) {
      return false
    }
    if (service.getStatus().status !== 'ready') {
      return false
    }
    return openFileInCodeServer(args.path)
  })

  ipcMain.handle('codeServer:getImportState', async (): Promise<CodeServerImportState> => {
    const [sources, preference] = await Promise.all([
      detectCodeServerImportSources(),
      readCodeServerImportPreference()
    ])
    return {
      sources,
      activeSourceId: preference.sourceId ?? null,
      promptDismissed: preference.promptDismissed === true
    }
  })

  ipcMain.handle('codeServer:dismissImportPrompt', async () => {
    await updateCodeServerImportPreference({ promptDismissed: true })
  })

  // Installs Orca shortcut forwarding on the code-server <webview> guest —
  // without it, no Orca chord fires while the embedded editor has focus.
  ipcMain.handle(
    'codeServer:registerGuest',
    (event, args: CodeServerGuestRegistrationArgs): boolean => {
      if (
        !args ||
        typeof args.codeServerTabId !== 'string' ||
        typeof args.webContentsId !== 'number'
      ) {
        return false
      }
      const guest = webContents.fromId(args.webContentsId)
      // Why: hostWebContents must be the invoking renderer, or a compromised
      // renderer could attach forwarding to another window's guest.
      if (
        !guest ||
        guest.isDestroyed() ||
        guest.getType() !== 'webview' ||
        guest.hostWebContents?.id !== event.sender.id
      ) {
        return false
      }
      registerCodeServerGuest({
        codeServerTabId: args.codeServerTabId,
        guest,
        rendererWebContentsId: event.sender.id,
        getKeybindings: options?.getKeybindings,
        shouldForwardDictationShortcut: () =>
          browserManager.shouldForwardDictationShortcutToGuests()
      })
      return true
    }
  )

  ipcMain.handle('codeServer:unregisterGuest', (_event, args: { codeServerTabId: string }) => {
    if (args && typeof args.codeServerTabId === 'string') {
      unregisterCodeServerGuest(args.codeServerTabId)
    }
  })

  ipcMain.handle(
    'codeServer:applyImport',
    async (_event, request: CodeServerImportRequest): Promise<CodeServerImportResult> => {
      try {
        // Persist first so every future start mirrors the chosen editor, then
        // re-link immediately for the (possibly running) current server.
        await updateCodeServerImportPreference({
          sourceId: request.sourceId,
          promptDismissed: true
        })
        await mirrorEditorUserConfig()
        const summary = request.includeExtensions
          ? await importExtensionsFromEditor(request.sourceId)
          : { imported: 0, skipped: 0 }
        const restarted = (await service.restartForConfigChange()) != null
        return {
          extensionsImported: summary.imported,
          extensionsSkipped: summary.skipped,
          restarted
        }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    }
  )
}
