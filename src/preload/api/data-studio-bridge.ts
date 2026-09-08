import { ipcRenderer } from 'electron'
import type {
  DataStudioEnsureRunningResult,
  DataStudioStatusEvent
} from '../../shared/data-studio-types'
import type { PreloadApi } from '../api-types'

export const dataStudioApi = {
  ensureRunning: (args: {
    repoId: string
    repoPath?: string
  }): Promise<DataStudioEnsureRunningResult | { error: string }> =>
    ipcRenderer.invoke('dataStudio:ensureRunning', args),
  retry: (args: { repoId: string }): Promise<DataStudioEnsureRunningResult | { error: string }> =>
    ipcRenderer.invoke('dataStudio:retry', args),
  release: (args: { repoId: string }): Promise<void> =>
    ipcRenderer.invoke('dataStudio:release', args),
  getStatus: (args: { repoId: string }): Promise<DataStudioStatusEvent | null> =>
    ipcRenderer.invoke('dataStudio:getStatus', args),
  onStatusChanged: (callback: (event: DataStudioStatusEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, event: DataStudioStatusEvent): void =>
      callback(event)
    ipcRenderer.on('dataStudio:statusChanged', listener)
    return () => ipcRenderer.removeListener('dataStudio:statusChanged', listener)
  }
} satisfies PreloadApi['dataStudio']
