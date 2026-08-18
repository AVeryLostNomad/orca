import { ipcMain, webContents } from 'electron'
import type {
  LspEnsureSessionArgs,
  LspResponseError,
  LspServerId,
  LspSessionEvent
} from '../../shared/lsp-types'
import { LspSessionManager } from '../lsp/lsp-session-manager'
import { onLspInstallStateChanged, resetLspInstallErrorState } from '../lsp/lsp-server-acquisition'

let manager: LspSessionManager | null = null
const cleanupTrackedWebContentsIds = new Set<number>()

function getManager(): LspSessionManager {
  manager ??= new LspSessionManager({
    emitEvent: (sessionId, event) => broadcastSessionEvent(sessionId, event)
  })
  return manager
}

function broadcastSessionEvent(sessionId: string, event: LspSessionEvent): void {
  const subscriberIds = getManager().subscriberIdsFor(sessionId)
  for (const webContentsId of subscriberIds) {
    const target = webContents.fromId(webContentsId)
    if (target && !target.isDestroyed()) {
      target.send('lsp:event', { sessionId, event })
    }
  }
}

function trackWebContentsCleanup(webContentsId: number): void {
  if (cleanupTrackedWebContentsIds.has(webContentsId)) {
    return
  }
  const target = webContents.fromId(webContentsId)
  if (!target) {
    return
  }
  cleanupTrackedWebContentsIds.add(webContentsId)
  target.once('destroyed', () => {
    cleanupTrackedWebContentsIds.delete(webContentsId)
    manager?.releaseWebContents(webContentsId)
  })
}

export function registerLspHandlers(): void {
  ipcMain.handle('lsp:ensureSession', async (event, args: LspEnsureSessionArgs) => {
    trackWebContentsCleanup(event.sender.id)
    return getManager().ensureSession(args.serverId, args.rootPath, event.sender.id)
  })

  ipcMain.handle('lsp:releaseSession', (event, args: { sessionId: string }) => {
    getManager().releaseSession(args.sessionId, event.sender.id)
  })

  ipcMain.handle(
    'lsp:request',
    (
      _event,
      args: { sessionId: string; clientRequestId: string; method: string; params: unknown }
    ) => getManager().request(args.sessionId, args.clientRequestId, args.method, args.params)
  )

  ipcMain.on(
    'lsp:cancelRequest',
    (_event, args: { sessionId: string; clientRequestId: string }) => {
      getManager().cancel(args.sessionId, args.clientRequestId)
    }
  )

  ipcMain.on(
    'lsp:notify',
    (event, args: { sessionId: string; method: string; params: unknown }) => {
      getManager().notify(args.sessionId, args.method, args.params, event.sender.id)
    }
  )

  ipcMain.on(
    'lsp:respondToServerRequest',
    (
      _event,
      args: {
        sessionId: string
        serverRequestId: number
        result?: unknown
        error?: LspResponseError
      }
    ) => {
      getManager().respondToServerRequest(
        args.sessionId,
        args.serverRequestId,
        args.result,
        args.error
      )
    }
  )

  ipcMain.handle('lsp:getServerStates', () => getManager().getServerStates())

  ipcMain.handle('lsp:retryServer', (_event, args: { serverId: LspServerId }) => {
    resetLspInstallErrorState(args.serverId)
    return getManager().getServerStates()
  })

  onLspInstallStateChanged((serverId, state) => {
    for (const target of webContents.getAllWebContents()) {
      if (!target.isDestroyed()) {
        target.send('lsp:serverStateChanged', { serverId, state })
      }
    }
  })
}

/** App will-quit: graceful shutdown/exit with a hard deadline, then tree-kill. */
export async function shutdownLspSessions(): Promise<void> {
  await manager?.shutdownAll()
}
