import { ipcMain } from 'electron'
import { readOmpStats } from '../pi/omp-stats-reader'

export function registerPaneUsageHandlers(): void {
  ipcMain.handle('paneUsage:getOmpStats', () => readOmpStats())
}
