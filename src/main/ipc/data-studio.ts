import { BrowserWindow, ipcMain } from 'electron'
import type { DataStudioStatusEvent } from '../../shared/data-studio-types'
import { getDataStudioRegistry } from '../data-studio/data-studio-registry'

// The Data Studio guest reuses codeServer:registerGuest/unregisterGuest for
// keyboard forwarding — same workbench UI, same 'vscode' keybinding context.
export function registerDataStudioHandlers(): void {
  const registry = getDataStudioRegistry()

  // Stale servers from a prior run, across every repo profile (including repos
  // not opened this session).
  registry.reapAllDataStudioOrphans()

  registry.onStatusChanged((event: DataStudioStatusEvent) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('dataStudio:statusChanged', event)
      }
    }
  })

  ipcMain.handle(
    'dataStudio:ensureRunning',
    async (_event, args: { repoId: string; repoPath?: string }) => {
      if (!args || typeof args.repoId !== 'string' || args.repoId.length === 0) {
        return { error: 'Invalid repoId' }
      }
      try {
        return await registry.acquire(
          args.repoId,
          typeof args.repoPath === 'string' ? args.repoPath : null
        )
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  // Non-refcounting re-drive for the pane's Retry button (see CodeServerManager.retry).
  ipcMain.handle('dataStudio:retry', async (_event, args: { repoId: string }) => {
    if (!args || typeof args.repoId !== 'string' || args.repoId.length === 0) {
      return { error: 'Invalid repoId' }
    }
    try {
      return await registry.retry(args.repoId)
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('dataStudio:release', (_event, args: { repoId: string }) => {
    if (args && typeof args.repoId === 'string') {
      registry.release(args.repoId)
    }
  })

  ipcMain.handle('dataStudio:getStatus', (_event, args: { repoId: string }) => {
    if (!args || typeof args.repoId !== 'string' || args.repoId.length === 0) {
      return null
    }
    return registry.getStatus(args.repoId)
  })
}
