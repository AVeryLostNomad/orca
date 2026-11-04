import { ipcRenderer } from 'electron'
import type { OmpStatsResult } from '../../shared/pane-usage-types'
import type { PreloadApi } from '../api-types'

export const paneUsageApi = {
  getOmpStats: (): Promise<OmpStatsResult> => ipcRenderer.invoke('paneUsage:getOmpStats')
} satisfies PreloadApi['paneUsage']
