import type {
  LspEnsureSessionResult,
  LspRequestResult,
  LspResponseError,
  LspServerId,
  LspServerStateSnapshot,
  LspSessionEvent
} from '../../shared/lsp-types'
import { ensureLspServerAvailable, type LspSpawnSpec } from './lsp-server-acquisition'
import { getLspServerEntry, type LspServerRegistryEntry } from './lsp-server-registry'
import { snapshotLspServerStates } from './lsp-server-state-snapshot'
import { LspSession, toIpcLspError, type LspSessionArgs } from './lsp-session'
import { routeLspDocumentNotification, takeLspDocumentsOwnedBy } from './lsp-document-ownership'
import {
  LSP_DEFAULT_IDLE_SHUTDOWN_MS,
  armLspIdleTimer,
  clearLspIdleTimer,
  clearManagedLspSessionTimers,
  createManagedLspSession,
  lspSessionKey,
  type ManagedLspSession
} from './lsp-managed-session-state'
import {
  armLspRestartStabilityTimer,
  detachLspSession,
  restartLspServerSessions,
  scheduleLspCrashRestart,
  type LspRestartHooks
} from './lsp-session-restart'

type SessionEventSink = (sessionId: string, event: LspSessionEvent) => void

type ManagedSession = ManagedLspSession

export class LspSessionManager {
  private readonly sessions = new Map<string, ManagedSession>()
  private nextSessionNumber = 1
  private shuttingDown = false

  constructor(
    private readonly deps: {
      emitEvent: SessionEventSink
      idleShutdownMs?: () => number
      /** Test seams — production uses the real acquisition + LspSession. */
      ensureServerAvailable?: (serverId: LspServerId) => Promise<LspSpawnSpec>
      createSession?: (args: LspSessionArgs, entry: LspServerRegistryEntry) => LspSession
    }
  ) {}

  private readonly restartHooks: LspRestartHooks = {
    isShuttingDown: () => this.shuttingDown,
    emitStatus: (managed) => this.emitStatus(managed),
    start: (managed) => this.startSession(managed)
  }

  private emitStatus(managed: ManagedSession): void {
    this.deps.emitEvent(managed.sessionId, {
      kind: 'status',
      status: managed.status,
      epoch: managed.epoch,
      error: managed.lastError
    })
  }

  async ensureSession(
    serverId: LspServerId,
    rootPath: string,
    webContentsId: number
  ): Promise<LspEnsureSessionResult> {
    if (this.shuttingDown) {
      return { ok: false, error: 'shutting down' }
    }
    const entry = getLspServerEntry(serverId)
    if (!entry) {
      return { ok: false, error: `unknown language server: ${serverId}` }
    }
    const key = lspSessionKey(serverId, rootPath)
    if (!this.sessions.has(key) && entry.sessionGate) {
      const refusal = await entry.sessionGate({ rootPath })
      if (refusal) {
        return { ok: false, error: refusal }
      }
    }
    let managed = this.sessions.get(key)
    if (!managed) {
      managed = createManagedLspSession(`lsp-${this.nextSessionNumber++}`, serverId, rootPath)
      this.sessions.set(key, managed)
    }
    managed.subscriberWebContentsIds.add(webContentsId)
    clearLspIdleTimer(managed)
    if (!managed.session && !managed.starting) {
      managed.starting = this.startSession(managed).finally(() => {
        managed.starting = null
      })
    }
    if (managed.starting) {
      try {
        await managed.starting
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
    if (!managed.session || managed.status === 'error') {
      return { ok: false, error: managed.lastError ?? 'language server failed to start' }
    }
    return {
      ok: true,
      sessionId: managed.sessionId,
      status: managed.status,
      epoch: managed.epoch,
      serverCapabilities: managed.session.serverCapabilities,
      projectInitializationPending: managed.session.projectInitializationPending
    }
  }

  private async startSession(managed: ManagedSession): Promise<void> {
    const entry = getLspServerEntry(managed.serverId)
    if (!entry) {
      throw new Error(`unknown language server: ${managed.serverId}`)
    }
    managed.status = 'installing'
    managed.lastError = undefined
    this.emitStatus(managed)
    try {
      const ensure = this.deps.ensureServerAvailable ?? ensureLspServerAvailable
      const spawnSpec = await ensure(managed.serverId)
      managed.status = 'starting'
      this.emitStatus(managed)
      const sessionArgs: LspSessionArgs = {
        sessionId: managed.sessionId,
        entry,
        spawnSpec,
        rootPath: managed.rootPath,
        onEvent: (event) => this.deps.emitEvent(managed.sessionId, event),
        onUnexpectedExit: () => this.handleUnexpectedExit(managed)
      }
      const session = this.deps.createSession
        ? this.deps.createSession(sessionArgs, entry)
        : new LspSession(sessionArgs)
      await session.start()
      // Idle stop or app shutdown may have dropped this entry while it started.
      if (
        this.shuttingDown ||
        this.sessions.get(lspSessionKey(managed.serverId, managed.rootPath)) !== managed
      ) {
        await session.dispose()
        return
      }
      managed.session = session
      managed.status = 'ready'
      managed.epoch += 1
      this.emitStatus(managed)
      armLspRestartStabilityTimer(managed)
    } catch (error) {
      managed.status = 'error'
      managed.lastError = error instanceof Error ? error.message : String(error)
      this.emitStatus(managed)
      throw error
    }
  }

  private handleUnexpectedExit(managed: ManagedSession): void {
    void detachLspSession(managed)?.dispose()
    if (this.shuttingDown || managed.subscriberWebContentsIds.size === 0) {
      this.removeSession(managed)
      return
    }
    scheduleLspCrashRestart(managed, this.restartHooks)
  }

  private findBySessionId(sessionId: string): ManagedSession | undefined {
    for (const managed of this.sessions.values()) {
      if (managed.sessionId === sessionId) {
        return managed
      }
    }
    return undefined
  }

  subscriberIdsFor(sessionId: string): ReadonlySet<number> {
    return this.findBySessionId(sessionId)?.subscriberWebContentsIds ?? new Set()
  }

  async request(
    sessionId: string,
    clientRequestId: string,
    method: string,
    params: unknown
  ): Promise<LspRequestResult> {
    const managed = this.findBySessionId(sessionId)
    if (!managed?.session) {
      return { ok: false, error: { code: -32603, message: 'no such session' } }
    }
    try {
      const result = await managed.session.request(clientRequestId, method, params)
      return { ok: true, result }
    } catch (error) {
      return { ok: false, error: toIpcLspError(error) }
    }
  }

  cancel(sessionId: string, clientRequestId: string): void {
    this.findBySessionId(sessionId)?.session?.cancel(clientRequestId)
  }

  notify(sessionId: string, method: string, params: unknown, webContentsId: number): void {
    const managed = this.findBySessionId(sessionId)
    const session = managed?.session
    if (!managed || !session) {
      return
    }
    const routing = routeLspDocumentNotification(
      session.openDocuments,
      method,
      params,
      webContentsId
    )
    if (!routing.forward) {
      return
    }
    if (method === 'textDocument/didOpen') {
      clearLspIdleTimer(managed)
    }
    if (routing.closedLast) {
      this.armIdleTimer(managed)
    }
    session.notify(method, params)
  }

  respondToServerRequest(
    sessionId: string,
    serverRequestId: number,
    result?: unknown,
    error?: LspResponseError
  ): void {
    this.findBySessionId(sessionId)?.session?.respondToServerRequest(serverRequestId, result, error)
  }

  releaseSession(sessionId: string, webContentsId: number): void {
    const managed = this.findBySessionId(sessionId)
    if (!managed) {
      return
    }
    managed.subscriberWebContentsIds.delete(webContentsId)
    this.dropDocumentsOwnedBy(managed, webContentsId)
    if (managed.subscriberWebContentsIds.size === 0) {
      this.armIdleTimer(managed)
    }
  }

  releaseWebContents(webContentsId: number): void {
    for (const managed of this.sessions.values()) {
      if (managed.subscriberWebContentsIds.has(webContentsId)) {
        this.releaseSession(managed.sessionId, webContentsId)
      }
    }
  }

  private dropDocumentsOwnedBy(managed: ManagedSession, webContentsId: number): void {
    const session = managed.session
    if (!session) {
      return
    }
    for (const uri of takeLspDocumentsOwnedBy(session.openDocuments, webContentsId)) {
      session.notify('textDocument/didClose', { textDocument: { uri } })
    }
    if (session.openDocuments.size === 0) {
      this.armIdleTimer(managed)
    }
  }

  private armIdleTimer(managed: ManagedSession): void {
    armLspIdleTimer(managed, this.deps.idleShutdownMs?.() ?? LSP_DEFAULT_IDLE_SHUTDOWN_MS, () => {
      void this.stopSession(managed)
    })
  }

  private async stopSession(managed: ManagedSession): Promise<void> {
    const session = managed.session
    managed.session = null
    managed.status = 'stopped'
    this.emitStatus(managed)
    this.removeSession(managed)
    await session?.dispose()
  }

  private removeSession(managed: ManagedSession): void {
    clearManagedLspSessionTimers(managed)
    this.sessions.delete(lspSessionKey(managed.serverId, managed.rootPath))
  }

  restartServer(serverId: LspServerId): Promise<void> {
    return restartLspServerSessions(this.sessions.values(), serverId, this.restartHooks)
  }

  getServerStates(): LspServerStateSnapshot[] {
    const activeByServer = new Map<LspServerId, number>()
    for (const managed of this.sessions.values()) {
      if (managed.session) {
        activeByServer.set(managed.serverId, (activeByServer.get(managed.serverId) ?? 0) + 1)
      }
    }
    return snapshotLspServerStates(activeByServer)
  }

  async shutdownAll(): Promise<void> {
    this.shuttingDown = true
    const disposals: Promise<void>[] = []
    // Snapshot first: removeSession mutates the map mid-iteration.
    for (const managed of Array.from(this.sessions.values())) {
      const session = managed.session
      managed.session = null
      this.removeSession(managed)
      if (session) {
        disposals.push(session.dispose())
      }
    }
    await Promise.allSettled(disposals)
  }
}
