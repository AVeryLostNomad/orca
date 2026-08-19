import type {
  LspEnsureSessionArgs,
  LspEnsureSessionResult,
  LspRequestResult,
  LspResponseError,
  LspSessionEvent
} from '../../../../shared/lsp-types'

/** Everything above this interface is transport-agnostic: today an Electron
 *  IPC implementation, later an SSH bridge for remote workspaces. */
export type LspTransport = {
  ensureSession: (args: LspEnsureSessionArgs) => Promise<LspEnsureSessionResult>
  releaseSession: (sessionId: string) => Promise<void>
  request: (
    sessionId: string,
    clientRequestId: string,
    method: string,
    params: unknown
  ) => Promise<LspRequestResult>
  cancelRequest: (sessionId: string, clientRequestId: string) => void
  notify: (sessionId: string, method: string, params: unknown) => void
  respondToServerRequest: (
    sessionId: string,
    serverRequestId: number,
    result?: unknown,
    error?: LspResponseError
  ) => void
  onEvent: (listener: (sessionId: string, event: LspSessionEvent) => void) => () => void
}
