import type { LspTransport } from './lsp-transport'

let singleton: LspTransport | null = null

export function getLspIpcTransport(): LspTransport | null {
  // Web-hosted renderers have no preload bridge; LSP is desktop-only for now.
  if (typeof window === 'undefined' || !window.api?.lsp) {
    return null
  }
  singleton ??= {
    ensureSession: (args) => window.api.lsp.ensureSession(args),
    releaseSession: (sessionId) => window.api.lsp.releaseSession({ sessionId }),
    request: (sessionId, clientRequestId, method, params) =>
      window.api.lsp.request({ sessionId, clientRequestId, method, params }),
    cancelRequest: (sessionId, clientRequestId) =>
      window.api.lsp.cancelRequest({ sessionId, clientRequestId }),
    notify: (sessionId, method, params) => window.api.lsp.notify({ sessionId, method, params }),
    respondToServerRequest: (sessionId, serverRequestId, result, error) =>
      window.api.lsp.respondToServerRequest({ sessionId, serverRequestId, result, error }),
    onEvent: (listener) =>
      window.api.lsp.onEvent(({ sessionId, event }) => listener(sessionId, event))
  }
  return singleton
}
