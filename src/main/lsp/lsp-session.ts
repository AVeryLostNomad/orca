import { spawn, type ChildProcess } from 'node:child_process'
import { URI } from 'vscode-uri'
import {
  CancellationTokenSource,
  createMessageConnection,
  ResponseError,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection
} from 'vscode-jsonrpc/node'
import type { LspResponseError, LspServerId, LspSessionEvent } from '../../shared/lsp-types'
import type { LspServerRegistryEntry } from './lsp-server-registry'
import type { LspSpawnSpec } from './lsp-server-acquisition'
import { LSP_CLIENT_CAPABILITIES } from './lsp-client-capabilities'
import { killProcessTree } from './lsp-process-termination'

const SHUTDOWN_GRACE_MS = 2000
const INITIALIZE_TIMEOUT_MS = 30_000

export type LspSessionArgs = {
  sessionId: string
  entry: LspServerRegistryEntry
  spawnSpec: LspSpawnSpec
  rootPath: string
  onEvent: (event: LspSessionEvent) => void
  onUnexpectedExit: () => void
}

function toLspResponseError(error: unknown): LspResponseError {
  if (error instanceof ResponseError) {
    return { code: error.code, message: error.message, data: error.data as unknown }
  }
  return { code: -32603, message: error instanceof Error ? error.message : String(error) }
}

export class LspSession {
  readonly serverId: LspServerId
  serverCapabilities: unknown = null
  private child: ChildProcess | null = null
  private connection: MessageConnection | null = null
  private disposed = false
  private readonly pendingCancellations = new Map<string, CancellationTokenSource>()
  private nextServerRequestId = 1
  private readonly pendingServerRequests = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (error: ResponseError<unknown>) => void }
  >()
  /** uri → ownerWebContentsId, so a second window's duplicate didOpen is dropped. */
  readonly openDocuments = new Map<string, number>()

  constructor(private readonly args: LspSessionArgs) {
    this.serverId = args.entry.id
  }

  async start(): Promise<void> {
    const { spawnSpec, entry, rootPath } = this.args
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      env: spawnSpec.env,
      cwd: rootPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.child = child
    child.stderr?.on('data', () => {
      // Servers log freely on stderr; consuming keeps the pipe from filling.
    })
    child.on('exit', () => {
      if (!this.disposed) {
        this.args.onUnexpectedExit()
      }
    })
    if (!child.stdout || !child.stdin) {
      throw new Error(`could not spawn ${spawnSpec.command}`)
    }
    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin)
    )
    this.connection = connection

    connection.onRequest((method, params) => this.handleServerRequest(method, params))
    connection.onNotification((method, params) => {
      this.args.onEvent({ kind: 'notification', method, params })
    })
    connection.onError(() => {
      // Exit handling owns recovery; per-message stream errors are not fatal here.
    })
    connection.listen()

    const rootUri = URI.file(rootPath).toString()
    const initializeParams = {
      processId: process.pid,
      rootUri,
      rootPath,
      workspaceFolders: [{ uri: rootUri, name: rootPath.split(/[\\/]/).pop() ?? rootPath }],
      capabilities: LSP_CLIENT_CAPABILITIES,
      initializationOptions: entry.initializationOptions?.({
        installRoot: this.args.spawnSpec.installRoot
      }),
      clientInfo: { name: 'orca' }
    }
    const initializeResult = await this.requestWithTimeout(
      'initialize',
      initializeParams,
      INITIALIZE_TIMEOUT_MS
    )
    this.serverCapabilities =
      (initializeResult as { capabilities?: unknown } | null)?.capabilities ?? null
    connection.sendNotification('initialized', {})
    if (entry.workspaceConfiguration) {
      connection.sendNotification('workspace/didChangeConfiguration', {
        settings: entry.workspaceConfiguration
      })
    }
  }

  private requestWithTimeout(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const connection = this.connection
    if (!connection) {
      return Promise.reject(new Error('session not started'))
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${method} timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
      connection.sendRequest(method, params).then(
        (result) => {
          clearTimeout(timer)
          resolve(result)
        },
        (error: unknown) => {
          clearTimeout(timer)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      )
    })
  }

  private handleServerRequest(method: string, params: unknown): unknown {
    if (method === 'workspace/configuration') {
      const items = (params as { items?: { section?: string }[] } | null)?.items ?? []
      const configuration = this.args.entry.workspaceConfiguration ?? {}
      return items.map((item) => resolveConfigurationSection(configuration, item.section))
    }
    if (method === 'client/registerCapability' || method === 'client/unregisterCapability') {
      return null
    }
    if (method === 'window/workDoneProgress/create') {
      return null
    }
    if (method === 'window/showMessageRequest') {
      // Never block a server on user input Orca doesn't surface yet.
      return null
    }
    // Everything else (workspace/applyEdit and friends) round-trips through the
    // renderer, which owns documents and can apply edits.
    const serverRequestId = this.nextServerRequestId++
    return new Promise((resolve, reject) => {
      this.pendingServerRequests.set(serverRequestId, { resolve, reject })
      this.args.onEvent({ kind: 'serverRequest', serverRequestId, method, params })
      setTimeout(() => {
        if (this.pendingServerRequests.delete(serverRequestId)) {
          reject(new ResponseError(-32603, `no client response for ${method}`))
        }
      }, 15_000)
    })
  }

  respondToServerRequest(
    serverRequestId: number,
    result?: unknown,
    error?: LspResponseError
  ): void {
    const pending = this.pendingServerRequests.get(serverRequestId)
    if (!pending) {
      return
    }
    this.pendingServerRequests.delete(serverRequestId)
    if (error) {
      pending.reject(new ResponseError(error.code, error.message, error.data))
    } else {
      pending.resolve(result ?? null)
    }
  }

  async request(clientRequestId: string, method: string, params: unknown): Promise<unknown> {
    const connection = this.connection
    if (!connection) {
      throw new ResponseError(-32603, 'language server is not running')
    }
    const source = new CancellationTokenSource()
    this.pendingCancellations.set(clientRequestId, source)
    try {
      return await connection.sendRequest(method, params, source.token)
    } finally {
      this.pendingCancellations.delete(clientRequestId)
      source.dispose()
    }
  }

  cancel(clientRequestId: string): void {
    this.pendingCancellations.get(clientRequestId)?.cancel()
  }

  notify(method: string, params: unknown): void {
    this.connection?.sendNotification(method, params)
  }

  /** Graceful LSP shutdown with a hard deadline, then tree-kill. */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return
    }
    this.disposed = true
    const connection = this.connection
    const child = this.child
    this.connection = null
    this.child = null
    for (const pending of this.pendingServerRequests.values()) {
      pending.reject(new ResponseError(-32603, 'session disposed'))
    }
    this.pendingServerRequests.clear()
    if (connection && child && child.exitCode === null) {
      try {
        await this.gracefulShutdown(connection)
      } catch {
        // Fall through to the kill below.
      }
    }
    connection?.dispose()
    if (child && child.exitCode === null) {
      await killProcessTree(child)
    }
  }

  private gracefulShutdown(connection: MessageConnection): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('shutdown timed out')), SHUTDOWN_GRACE_MS)
      connection.sendRequest('shutdown', null).then(
        () => {
          clearTimeout(timer)
          try {
            connection.sendNotification('exit', null)
          } catch {
            // The transport may already be gone.
          }
          resolve()
        },
        (error: unknown) => {
          clearTimeout(timer)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      )
    })
  }
}

function resolveConfigurationSection(
  configuration: Record<string, unknown>,
  section: string | undefined
): unknown {
  if (!section) {
    return configuration
  }
  let current: unknown = configuration
  for (const part of section.split('.')) {
    if (typeof current !== 'object' || current === null) {
      return null
    }
    current = (current as Record<string, unknown>)[part]
  }
  return current ?? null
}

export function toIpcLspError(error: unknown): LspResponseError {
  return toLspResponseError(error)
}
