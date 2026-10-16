import { mkdir } from 'node:fs/promises'
import { shell } from 'electron'
import { getLogsDirectory } from './logs-directory'

/** Opens the folder holding main.trace.ndjson (stall, slow-operation and long-frame spans). */
export async function openLogsDirectory(): Promise<void> {
  const logsDirectory = getLogsDirectory()
  try {
    // Why: with diagnostics disabled the sink never created the folder, and openPath fails on a missing path.
    await mkdir(logsDirectory, { recursive: true })
    const errorMessage = await shell.openPath(logsDirectory)
    if (errorMessage) {
      console.warn('[observability] failed to open logs directory:', errorMessage)
    }
  } catch (error) {
    console.warn('[observability] failed to open logs directory:', error)
  }
}
