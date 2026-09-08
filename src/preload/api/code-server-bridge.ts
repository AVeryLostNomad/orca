import { ipcRenderer } from 'electron'
import type {
  CodeServerImportRequest,
  CodeServerImportResult,
  CodeServerImportState,
  CodeServerStatusEvent
} from '../../shared/code-server-types'
import type { PreloadApi } from '../api-types'

export const codeServerApi = {
  ensureRunning: (): Promise<{ port: number } | { error: string }> =>
    ipcRenderer.invoke('codeServer:ensureRunning'),
  retry: (): Promise<{ port: number } | { error: string }> =>
    ipcRenderer.invoke('codeServer:retry'),
  release: (): Promise<void> => ipcRenderer.invoke('codeServer:release'),
  getStatus: (): Promise<CodeServerStatusEvent> => ipcRenderer.invoke('codeServer:getStatus'),
  openFile: (args: { path: string }): Promise<boolean> =>
    ipcRenderer.invoke('codeServer:openFile', args),
  onStatusChanged: (callback: (event: CodeServerStatusEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, event: CodeServerStatusEvent): void =>
      callback(event)
    ipcRenderer.on('codeServer:statusChanged', listener)
    return () => ipcRenderer.removeListener('codeServer:statusChanged', listener)
  },
  getImportState: (): Promise<CodeServerImportState> =>
    ipcRenderer.invoke('codeServer:getImportState'),
  dismissImportPrompt: (): Promise<void> => ipcRenderer.invoke('codeServer:dismissImportPrompt'),
  applyImport: (request: CodeServerImportRequest): Promise<CodeServerImportResult> =>
    ipcRenderer.invoke('codeServer:applyImport', request),
  registerGuest: (args: { codeServerTabId: string; webContentsId: number }): Promise<boolean> =>
    ipcRenderer.invoke('codeServer:registerGuest', args),
  unregisterGuest: (args: { codeServerTabId: string }): Promise<void> =>
    ipcRenderer.invoke('codeServer:unregisterGuest', args)
} satisfies PreloadApi['codeServer']
