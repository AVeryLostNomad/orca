import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { Worker } from 'node:worker_threads'
import type { ProcessResult } from '@orca/process-host/process-spec'
import { LazyWorkerThreadHost, type WorkerThreadFactory } from '../lazy-worker-thread-host'
import { currentWorkerEntryLayout, resolveWorkerThreadEntryPath } from '../worker-thread-entry-path'
import type {
  WorkerThreadChildErrorPayload,
  WorkerThreadChildEvent,
  WorkerThreadChildRequest,
  WorkerThreadChildSpec,
  WorkerThreadRunResult,
  WorkerThreadRunSpec
} from './worker-thread-child-process-protocol'

// #27362: Windows code-integrity/EDR hooks can block CreateProcessW for seconds on the calling loop, so spawn in a worker (#11161).

// Amortize worker startup across nearby probes.
export const IDLE_TEARDOWN_MS = 2 * 60_000

const WORKER_ENTRY_FILENAME = 'worker-thread-child-process-entry.js'
// Node reports a negative errno as the exit code of a child that never started.
const SPAWN_FAILED_EXIT_CODE = -1

/** False when the child is no longer reachable through a live worker. */
type SendRequest = (request: WorkerThreadChildRequest) => boolean

type PendingRun = {
  resolve: (result: ProcessResult) => void
  reject: (error: Error) => void
  /** Cleared once reported; runProcess may report termination after it settles. */
  onChildTerminated?: () => void
  settled: boolean
  detachAbort: () => void
}

function toProcessResult(result: WorkerThreadRunResult): ProcessResult {
  // Structured clone turns each Buffer into a plain Uint8Array.
  const toBuffer = (bytes: Uint8Array): Buffer =>
    Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    ...result,
    stdoutBytes: result.stdoutBytes ? toBuffer(result.stdoutBytes) : undefined,
    stderrBytes: result.stderrBytes ? toBuffer(result.stderrBytes) : undefined
  }
}

function toError(payload: WorkerThreadChildErrorPayload): Error {
  const error: NodeJS.ErrnoException = new Error(payload.message)
  if (payload.code) {
    error.code = payload.code
  }
  return error
}

// Never emits: the worker reports stdin failures as child 'error' events.
class WorkerThreadChildStdin extends EventEmitter {
  constructor(
    private readonly id: number,
    private readonly send: SendRequest
  ) {
    super()
  }

  write(data: string): boolean {
    this.send({ type: 'stdin-write', id: this.id, data })
    return true
  }

  end(): void {
    this.send({ type: 'stdin-end', id: this.id })
  }
}

/** Main-thread stand-in for a piped ChildProcess whose real process lives on the worker. */
export class WorkerThreadChildProcess extends EventEmitter {
  pid: number | undefined = undefined
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  readonly stdin: WorkerThreadChildStdin
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()

  constructor(
    readonly id: number,
    private readonly send: SendRequest
  ) {
    super()
    this.stdin = new WorkerThreadChildStdin(id, send)
  }

  kill(signal?: NodeJS.Signals): boolean {
    if (this.exitCode !== null || this.signalCode !== null) {
      return false
    }
    return this.send({ type: 'kill', id: this.id, signal })
  }

  receive(event: WorkerThreadChildEvent): void {
    switch (event.type) {
      case 'spawn':
        this.pid = event.pid
        this.emit('spawn')
        return
      case 'stdout':
      case 'stderr':
        try {
          this[event.type].emit(
            'data',
            Buffer.from(event.chunk.buffer, event.chunk.byteOffset, event.chunk.byteLength)
          )
        } finally {
          this.send({ type: 'output-consumed', id: this.id, bytes: event.chunk.byteLength })
        }
        return
      case 'error':
        this.emitErrorIfObserved(event.error)
        return
      case 'spawn-error':
        this.emitErrorIfObserved(event.error)
        this.receive({ type: 'exit', id: this.id, code: SPAWN_FAILED_EXIT_CODE, signal: null })
        this.receive({ type: 'close', id: this.id, code: SPAWN_FAILED_EXIT_CODE, signal: null })
        return
      case 'exit':
        this.exitCode = event.code
        this.signalCode = event.signal
        this.emit('exit', event.code, event.signal)
        return
      case 'close':
        this.emit('close', event.code, event.signal)
    }
  }

  // Ignore unobserved late errors after caller detach or EventEmitter would throw fatally into main.
  private emitErrorIfObserved(payload: WorkerThreadChildErrorPayload): void {
    if (this.listenerCount('error') > 0) {
      this.emit('error', toError(payload))
    }
  }
}

export class WorkerThreadChildProcessHost {
  private readonly host: LazyWorkerThreadHost<WorkerThreadChildEvent>
  private readonly children = new Map<number, WorkerThreadChildProcess>()
  private readonly runs = new Map<number, PendingRun>()
  private nextId = 1

  constructor(factory: WorkerThreadFactory) {
    this.host = new LazyWorkerThreadHost<WorkerThreadChildEvent>({
      factory,
      idleTeardownMs: IDLE_TEARDOWN_MS,
      onMessage: (event) => this.route(event),
      onError: (error) => this.abandonAll(`Child process worker failed: ${error.message}`),
      onExit: (code) => this.abandonAll(`Child process worker exited with code ${code}`),
      isIdle: () => this.children.size === 0 && this.runs.size === 0,
      onUnavailable: (error) =>
        console.warn(
          `[worker-thread-child-process] worker unavailable. ${error instanceof Error ? error.message : String(error)}`
        )
    })
  }

  spawn(spec: WorkerThreadChildSpec): WorkerThreadChildProcess {
    const child = this.trySpawn(spec)
    if (child) {
      return child
    }
    const unavailable = new WorkerThreadChildProcess(this.nextId++, () => false)
    // Deferred like Node's own spawn errors, so the caller can attach listeners first.
    process.nextTick(() =>
      unavailable.receive({
        type: 'spawn-error',
        id: unavailable.id,
        error: { message: 'Child process worker is unavailable' }
      })
    )
    return unavailable
  }

  /** Null when no worker can take the spawn, so callers may spawn inline instead. */
  trySpawn(spec: WorkerThreadChildSpec): WorkerThreadChildProcess | null {
    if (!this.host.ensure()) {
      return null
    }
    const id = this.nextId++
    const child = new WorkerThreadChildProcess(id, (request) => this.post(request))
    this.host.clearIdleTimer()
    this.children.set(id, child)
    if (this.post({ type: 'spawn', id, spec })) {
      return child
    }
    this.forget(id)
    return null
  }

  /** runProcess with a boolean termination barrier on the worker; null when no worker is available. */
  run(
    spec: WorkerThreadRunSpec,
    options: { signal?: AbortSignal; onChildTerminated?: () => void } = {}
  ): Promise<ProcessResult> | null {
    if (!this.host.ensure()) {
      return null
    }
    const { signal, onChildTerminated } = options
    if (signal?.aborted) {
      // Match runProcess: an already-aborted call starts no child.
      onChildTerminated?.()
      return Promise.resolve({ code: null, signal: null, stdout: '', stderr: '', timedOut: false })
    }
    const id = this.nextId++
    const pending = Promise.withResolvers<ProcessResult>()
    const onAbort = (): void => {
      this.post({ type: 'run-abort', id })
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    this.host.clearIdleTimer()
    this.runs.set(id, {
      resolve: pending.resolve,
      reject: pending.reject,
      onChildTerminated,
      settled: false,
      detachAbort: () => signal?.removeEventListener('abort', onAbort)
    })
    if (this.post({ type: 'run', id, spec })) {
      return pending.promise
    }
    this.runs.get(id)?.detachAbort()
    this.forget(id)
    return null
  }

  private post(request: WorkerThreadChildRequest): boolean {
    const worker = this.host.current
    if (!worker || !(this.children.has(request.id) || this.runs.has(request.id))) {
      return false
    }
    try {
      worker.postMessage(request)
      return true
    } catch {
      return false
    }
  }

  private route(event: WorkerThreadChildEvent): void {
    if (
      event.type === 'run-terminated' ||
      event.type === 'run-result' ||
      event.type === 'run-error'
    ) {
      this.routeRun(event)
      return
    }
    const child = this.children.get(event.id)
    if (!child) {
      return
    }
    if (event.type === 'close' || event.type === 'spawn-error') {
      this.forget(event.id)
    }
    child.receive(event)
  }

  private routeRun(
    event: Extract<WorkerThreadChildEvent, { type: 'run-terminated' | 'run-result' | 'run-error' }>
  ): void {
    const run = this.runs.get(event.id)
    if (!run) {
      return
    }
    if (event.type === 'run-terminated') {
      const report = run.onChildTerminated
      run.onChildTerminated = undefined
      if (run.settled) {
        this.forget(event.id)
      }
      report?.()
      return
    }
    run.detachAbort()
    run.settled = true
    // Keep the entry (and worker) until termination evidence arrives, as inline runProcess would.
    if (!run.onChildTerminated) {
      this.forget(event.id)
    }
    if (event.type === 'run-result') {
      run.resolve(toProcessResult(event.result))
    } else {
      run.reject(toError(event.error))
    }
  }

  private forget(id: number): void {
    this.children.delete(id)
    this.runs.delete(id)
    if (this.children.size === 0 && this.runs.size === 0) {
      this.host.scheduleIdleTeardown()
    }
  }

  // Worker death closes stdin for graceful stop but proves no child exit; omit close so drain windows/home locks still expire normally.
  private abandonAll(message: string): void {
    const abandoned = [...this.children.values()]
    const abandonedRuns = [...this.runs.values()]
    this.children.clear()
    this.runs.clear()
    this.host.destroy()
    for (const child of abandoned) {
      child.receive({ type: 'error', id: child.id, error: { message } })
    }
    for (const run of abandonedRuns) {
      run.detachAbort()
      run.reject(new Error(message))
    }
  }
}

function defaultWorkerFactory(): Worker {
  const workerPath = resolveWorkerThreadEntryPath(
    currentWorkerEntryLayout(__dirname),
    WORKER_ENTRY_FILENAME
  )
  // Reject missing worker synchronously so spawning fails closed instead of awaiting impossible readiness.
  if (!existsSync(workerPath)) {
    throw new Error(`Child process worker entry not found: ${workerPath}`)
  }
  return new Worker(workerPath)
}

let sharedHost: WorkerThreadChildProcessHost | null = null

export function sharedWorkerThreadChildProcessHost(): WorkerThreadChildProcessHost {
  sharedHost ??= new WorkerThreadChildProcessHost(defaultWorkerFactory)
  return sharedHost
}

/** Fails closed: an unavailable worker surfaces as a spawn error. */
export function spawnProcessOnWorkerThread(spec: WorkerThreadChildSpec): WorkerThreadChildProcess {
  return sharedWorkerThreadChildProcessHost().spawn(spec)
}
