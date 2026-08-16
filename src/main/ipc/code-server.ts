import { BrowserWindow, ipcMain } from 'electron'
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
import { mirrorEditorUserConfig } from '../code-server/code-server-editor-user-config'

export function registerCodeServerHandlers(): void {
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
