import { ipcRenderer } from 'electron'
import type {
  LspEnsureSessionArgs,
  LspEnsureSessionResult,
  LspRequestResult,
  LspResponseError,
  LspServerId,
  LspServerInstallState,
  LspServerStateSnapshot,
  LspSessionEvent
} from '../../shared/lsp-types'
import type { PreloadApi } from '../api-types'

export const lspApi = {
  ensureSession: (args: LspEnsureSessionArgs): Promise<LspEnsureSessionResult> =>
    ipcRenderer.invoke('lsp:ensureSession', args),
  releaseSession: (args: { sessionId: string }): Promise<void> =>
    ipcRenderer.invoke('lsp:releaseSession', args),
  request: (args: {
    sessionId: string
    clientRequestId: string
    method: string
    params: unknown
  }): Promise<LspRequestResult> => ipcRenderer.invoke('lsp:request', args),
  cancelRequest: (args: { sessionId: string; clientRequestId: string }): void => {
    ipcRenderer.send('lsp:cancelRequest', args)
  },
  notify: (args: { sessionId: string; method: string; params: unknown }): void => {
    ipcRenderer.send('lsp:notify', args)
  },
  respondToServerRequest: (args: {
    sessionId: string
    serverRequestId: number
    result?: unknown
    error?: LspResponseError
  }): void => {
    ipcRenderer.send('lsp:respondToServerRequest', args)
  },
  onEvent: (
    callback: (payload: { sessionId: string; event: LspSessionEvent }) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { sessionId: string; event: LspSessionEvent }
    ): void => callback(payload)
    ipcRenderer.on('lsp:event', listener)
    return () => ipcRenderer.removeListener('lsp:event', listener)
  },
  getServerStates: (): Promise<LspServerStateSnapshot[]> =>
    ipcRenderer.invoke('lsp:getServerStates'),
  retryServer: (args: { serverId: LspServerId }): Promise<LspServerStateSnapshot[]> =>
    ipcRenderer.invoke('lsp:retryServer', args),
  onServerStateChanged: (
    callback: (payload: { serverId: LspServerId; state: LspServerInstallState }) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { serverId: LspServerId; state: LspServerInstallState }
    ): void => callback(payload)
    ipcRenderer.on('lsp:serverStateChanged', listener)
    return () => ipcRenderer.removeListener('lsp:serverStateChanged', listener)
  }
} satisfies PreloadApi['lsp']
