import type { CodeServerStatusEvent } from '../../shared/code-server-types'

export type CodeServerApi = {
  ensureRunning: () => Promise<{ port: number } | { error: string }>
  retry: () => Promise<{ port: number } | { error: string }>
  release: () => Promise<void>
  getStatus: () => Promise<CodeServerStatusEvent>
  onStatusChanged: (callback: (event: CodeServerStatusEvent) => void) => () => void
}
