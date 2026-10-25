import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const prototypesApi = {
  create: () => ipcRenderer.invoke('prototypes:create'),
  preflightPromote: (args) => ipcRenderer.invoke('prototypes:preflightPromote', args),
  promote: (args) => ipcRenderer.invoke('prototypes:promote', args),
  deleteFiles: (args) => ipcRenderer.invoke('prototypes:deleteFiles', args)
} satisfies PreloadApi['prototypes']
