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

export type LspApi = {
  ensureSession: (args: LspEnsureSessionArgs) => Promise<LspEnsureSessionResult>
  releaseSession: (args: { sessionId: string }) => Promise<void>
  request: (args: {
    sessionId: string
    clientRequestId: string
    method: string
    params: unknown
  }) => Promise<LspRequestResult>
  cancelRequest: (args: { sessionId: string; clientRequestId: string }) => void
  notify: (args: { sessionId: string; method: string; params: unknown }) => void
  respondToServerRequest: (args: {
    sessionId: string
    serverRequestId: number
    result?: unknown
    error?: LspResponseError
  }) => void
  onEvent: (
    callback: (payload: { sessionId: string; event: LspSessionEvent }) => void
  ) => () => void
  getServerStates: () => Promise<LspServerStateSnapshot[]>
  retryServer: (args: { serverId: LspServerId }) => Promise<LspServerStateSnapshot[]>
  onServerStateChanged: (
    callback: (payload: { serverId: LspServerId; state: LspServerInstallState }) => void
  ) => () => void
}
