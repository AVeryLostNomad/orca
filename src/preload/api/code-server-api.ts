import type {
  CodeServerImportRequest,
  CodeServerImportResult,
  CodeServerImportState,
  CodeServerStatusEvent
} from '../../shared/code-server-types'

export type CodeServerApi = {
  ensureRunning: () => Promise<{ port: number } | { error: string }>
  retry: () => Promise<{ port: number } | { error: string }>
  release: () => Promise<void>
  getStatus: () => Promise<CodeServerStatusEvent>
  onStatusChanged: (callback: (event: CodeServerStatusEvent) => void) => () => void
  getImportState: () => Promise<CodeServerImportState>
  dismissImportPrompt: () => Promise<void>
  applyImport: (request: CodeServerImportRequest) => Promise<CodeServerImportResult>
  registerGuest: (args: { codeServerTabId: string; webContentsId: number }) => Promise<boolean>
  unregisterGuest: (args: { codeServerTabId: string }) => Promise<void>
}
