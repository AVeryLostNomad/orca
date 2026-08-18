import type { CancellationToken } from 'monaco-editor'
import type { LspServerId, LspSessionEvent, LspSessionStatus } from '../../../../shared/lsp-types'
import { LSP_REQUEST_CANCELLED_CODE } from '../../../../shared/lsp-types'
import { getLspIpcTransport } from './lsp-ipc-transport'
import type { LspTransport } from './lsp-transport'

export type LspWorkspaceSession = {
  serverId: LspServerId
  rootPath: string
  sessionId: string
  epoch: number
  capabilities: Record<string, unknown>
  status: LspSessionStatus
}

const ENSURE_FAILURE_RETRY_MS = 30_000

const sessionPromisesByKey = new Map<string, Promise<LspWorkspaceSession | null>>()
const sessionsById = new Map<string, LspWorkspaceSession>()
const notificationListeners = new Map<string, Map<string, Set<(params: unknown) => void>>>()
const statusListeners = new Map<string, Set<(session: LspWorkspaceSession) => void>>()
const serverRequestHandlers = new Map<
  string,
  (session: LspWorkspaceSession, params: unknown) => Promise<unknown>
>()
let transportSubscribed = false
let nextClientRequestId = 1

function sessionKey(serverId: LspServerId, rootPath: string): string {
  return `${serverId} ${rootPath}`
}

function transport(): LspTransport | null {
  return getLspIpcTransport()
}

function subscribeTransportOnce(): void {
  if (transportSubscribed) {
    return
  }
  const active = transport()
  if (!active) {
    return
  }
  transportSubscribed = true
  active.onEvent((sessionId, event) => dispatchEvent(sessionId, event))
}

function dispatchEvent(sessionId: string, event: LspSessionEvent): void {
  const session = sessionsById.get(sessionId)
  if (!session) {
    return
  }
  if (event.kind === 'notification') {
    const listeners = notificationListeners.get(sessionId)?.get(event.method)
    if (listeners) {
      for (const listener of listeners) {
        listener(event.params)
      }
    }
    return
  }
  if (event.kind === 'status') {
    session.status = event.status
    session.epoch = event.epoch
    const listeners = statusListeners.get(sessionId)
    if (listeners) {
      for (const listener of listeners) {
        listener(session)
      }
    }
    return
  }
  const handler = serverRequestHandlers.get(event.method)
  const active = transport()
  if (!active) {
    return
  }
  if (!handler) {
    active.respondToServerRequest(sessionId, event.serverRequestId, undefined, {
      code: -32601,
      message: `unhandled server request: ${event.method}`
    })
    return
  }
  handler(session, event.params).then(
    (result) => active.respondToServerRequest(sessionId, event.serverRequestId, result),
    (error: unknown) =>
      active.respondToServerRequest(sessionId, event.serverRequestId, undefined, {
        code: -32603,
        message: error instanceof Error ? error.message : String(error)
      })
  )
}

/** Register the renderer-side answer for a server→client request method
 *  (e.g. workspace/applyEdit). Last registration wins; module-level singletons. */
export function registerLspServerRequestHandler(
  method: string,
  handler: (session: LspWorkspaceSession, params: unknown) => Promise<unknown>
): void {
  serverRequestHandlers.set(method, handler)
}

export function ensureLspSession(
  serverId: LspServerId,
  rootPath: string
): Promise<LspWorkspaceSession | null> {
  const active = transport()
  if (!active) {
    return Promise.resolve(null)
  }
  subscribeTransportOnce()
  const key = sessionKey(serverId, rootPath)
  let pending = sessionPromisesByKey.get(key)
  if (!pending) {
    pending = active.ensureSession({ serverId, rootPath }).then(
      (result) => {
        if (!result.ok) {
          // Leave failures retryable, but not on a hot loop.
          setTimeout(() => sessionPromisesByKey.delete(key), ENSURE_FAILURE_RETRY_MS)
          return null
        }
        const existing = sessionsById.get(result.sessionId)
        if (existing) {
          existing.status = result.status
          existing.epoch = result.epoch
          return existing
        }
        const session: LspWorkspaceSession = {
          serverId,
          rootPath,
          sessionId: result.sessionId,
          epoch: result.epoch,
          capabilities: (result.serverCapabilities as Record<string, unknown> | null) ?? {},
          status: result.status
        }
        sessionsById.set(result.sessionId, session)
        return session
      },
      () => {
        setTimeout(() => sessionPromisesByKey.delete(key), ENSURE_FAILURE_RETRY_MS)
        return null
      }
    )
    sessionPromisesByKey.set(key, pending)
  }
  return pending
}

/** Send a request; resolves undefined on cancellation or server error (provider
 *  callers treat both as "no result"). */
export async function requestLsp<T>(
  session: LspWorkspaceSession,
  method: string,
  params: unknown,
  token?: CancellationToken
): Promise<T | undefined> {
  const active = transport()
  if (!active || session.status !== 'ready') {
    return undefined
  }
  const clientRequestId = String(nextClientRequestId++)
  const cancellation = token?.onCancellationRequested(() => {
    active.cancelRequest(session.sessionId, clientRequestId)
  })
  try {
    const result = await active.request(session.sessionId, clientRequestId, method, params)
    if (!result.ok) {
      if (result.error.code !== LSP_REQUEST_CANCELLED_CODE) {
        console.debug(`[lsp] ${session.serverId} ${method} failed: ${result.error.message}`)
      }
      return undefined
    }
    return result.result as T
  } finally {
    cancellation?.dispose()
  }
}

export function notifyLsp(session: LspWorkspaceSession, method: string, params: unknown): void {
  transport()?.notify(session.sessionId, method, params)
}

export function onLspNotification(
  session: LspWorkspaceSession,
  method: string,
  listener: (params: unknown) => void
): () => void {
  let byMethod = notificationListeners.get(session.sessionId)
  if (!byMethod) {
    byMethod = new Map()
    notificationListeners.set(session.sessionId, byMethod)
  }
  let listeners = byMethod.get(method)
  if (!listeners) {
    listeners = new Set()
    byMethod.set(method, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function onLspSessionStatus(
  session: LspWorkspaceSession,
  listener: (session: LspWorkspaceSession) => void
): () => void {
  let listeners = statusListeners.get(session.sessionId)
  if (!listeners) {
    listeners = new Set()
    statusListeners.set(session.sessionId, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
