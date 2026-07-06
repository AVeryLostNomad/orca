import { BrowserWindow, ipcMain } from 'electron'
import type { CodeServerStatusEvent } from '../../shared/code-server-types'
import { getCodeServerService } from '../code-server/code-server-service'

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

  ipcMain.handle('codeServer:release', () => {
    service.release()
  })

  ipcMain.handle('codeServer:getStatus', () => service.getStatus())
}
