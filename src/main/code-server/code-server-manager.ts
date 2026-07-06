import { spawn, type ChildProcess } from 'node:child_process'
import { net } from 'electron'
import { createServer } from 'node:net'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import type { CodeServerStatus, CodeServerStatusEvent } from '../../shared/code-server-types'
import { ensureCodeServerInstalled } from './code-server-installer'
import { linkVsCodeUserSettings } from './code-server-vscode-settings-link'
import {
  getCodeServerExtensionsDir,
  getCodeServerPidFilePath,
  getCodeServerUserDataDir,
  resolveCodeServerExecutable
} from './code-server-paths'

const READY_TIMEOUT_MS = 20_000
const READY_POLL_MS = 200
// Cap retained stderr so a chatty code-server can't grow this unbounded while running.
const STDERR_TAIL_MAX_BYTES = 8 * 1024

export function buildCodeServerArgs(port: number): string[] {
  return [
    '--bind-addr',
    `127.0.0.1:${port}`,
    '--auth',
    'none',
    '--disable-telemetry',
    '--user-data-dir',
    getCodeServerUserDataDir(),
    '--extensions-dir',
    getCodeServerExtensionsDir()
  ]
}

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to allocate a port'))
        return
      }
      const { port } = address
      server.close(() => resolve(port))
    })
  })
}

async function waitForHealthz(port: number): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() <= deadline) {
    const ok = await probeHealthz(port)
    if (ok) {
      return true
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS))
  }
  return false
}

function probeHealthz(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = net.request(`http://127.0.0.1:${port}/healthz`)
    request.on('response', (response) => {
      response.on('data', () => {})
      response.on('end', () => resolve(response.statusCode === 200))
    })
    request.on('error', () => resolve(false))
    request.end()
  })
}

export type CodeServerProvider = {
  acquire(): Promise<{ port: number }>
  retry(): Promise<{ port: number }>
  release(): void
  getStatus(): CodeServerStatusEvent
  onStatusChanged(cb: (e: CodeServerStatusEvent) => void): () => void
  shutdown(): Promise<void>
}

export class CodeServerManager implements CodeServerProvider {
  private child: ChildProcess | null = null
  private port: number | null = null
  private refCount = 0
  private quitting = false
  // Reachable 'not-installed' start state (fix: was hardcoded 'stopped', hiding the
  // real state machine's entry point from callers that check status before acquire()).
  private status: CodeServerStatus = resolveCodeServerExecutable() ? 'stopped' : 'not-installed'
  private errorMessage: string | undefined
  private readonly listeners = new Set<(e: CodeServerStatusEvent) => void>()
  // Single-flight guard: overlapping acquire() calls before the first reaches 'ready'
  // must share one start sequence, or each spawns its own untracked child process.
  private starting: Promise<{ port: number }> | null = null

  onStatusChanged(cb: (e: CodeServerStatusEvent) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  getStatus(): CodeServerStatusEvent {
    return { status: this.status, port: this.port, error: this.errorMessage }
  }

  private emit(status: CodeServerStatus, extra?: { progress?: number; error?: string }): void {
    this.status = status
    this.errorMessage = extra?.error
    const event: CodeServerStatusEvent = { status, port: this.port, ...extra }
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  async acquire(): Promise<{ port: number }> {
    this.refCount += 1
    if (this.child && this.port && this.status === 'ready') {
      return { port: this.port }
    }
    // Overlapping callers (e.g. session restore reopening several tabs) share this one
    // in-flight start instead of each racing startProcess() and leaking a child.
    if (!this.starting) {
      this.starting = this.startSequence().finally(() => {
        this.starting = null
      })
    }
    try {
      return await this.starting
    } catch (error) {
      this.refCount = Math.max(0, this.refCount - 1)
      throw error
    }
  }

  // Re-drive a start after a failure WITHOUT taking a ref. The pane already
  // holds exactly one ref from mount; a second acquire here would inflate
  // refCount so release() never reaches 0 and the shared server would never
  // stop when the last vscode tab closes. Shares the single-flight guard so a
  // concurrent acquire and retry don't spawn two children.
  async retry(): Promise<{ port: number }> {
    if (this.child && this.port && this.status === 'ready') {
      return { port: this.port }
    }
    if (!this.starting) {
      this.starting = this.startSequence().finally(() => {
        this.starting = null
      })
    }
    return this.starting
  }

  private async startSequence(): Promise<{ port: number }> {
    try {
      this.reapOrphan()
      // Only pass through 'installing' when an install will actually happen —
      // otherwise a normal start flashes "installing 0%" for an already-installed binary.
      if (!resolveCodeServerExecutable()) {
        this.emit('installing', { progress: 0 })
        await ensureCodeServerInstalled((fraction) =>
          this.emit('installing', { progress: fraction })
        )
      }
      await linkVsCodeUserSettings()
      const port = await this.startProcess()
      return { port }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.emit('error', { error: message })
      throw error
    }
  }

  private async startProcess(): Promise<number> {
    const exe = await ensureCodeServerInstalled()
    const port = await pickFreePort()
    this.emit('starting')
    const child = spawn(exe, buildCodeServerArgs(port), {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true
    })
    this.child = child
    this.port = port
    writeFileSync(getCodeServerPidFilePath(), String(child.pid ?? ''))
    child.on('exit', () => this.handleUnexpectedExit())

    let stderrTail = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_MAX_BYTES)
    })

    const ready = await waitForHealthz(port)
    if (!ready) {
      this.killChild()
      const detail = stderrTail.trim()
      throw new Error(
        detail
          ? `code-server did not become ready in time: ${detail}`
          : 'code-server did not become ready in time'
      )
    }
    this.emit('ready')
    return port
  }

  private handleUnexpectedExit(): void {
    this.child = null
    this.port = null
    if (this.quitting || this.refCount <= 0) {
      this.emit('stopped')
      return
    }
    // Crash while tabs are open — auto-restart.
    void this.startProcess().catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      this.emit('error', { error: message })
    })
  }

  release(): void {
    this.refCount = Math.max(0, this.refCount - 1)
    if (this.refCount === 0) {
      this.killChild()
      this.emit('stopped')
    }
  }

  private killChild(): void {
    const child = this.child
    this.child = null
    this.port = null
    if (child && !child.killed) {
      child.removeAllListeners('exit')
      child.kill('SIGTERM')
    }
    try {
      rmSync(getCodeServerPidFilePath(), { force: true })
    } catch {
      // best effort
    }
  }

  async shutdown(): Promise<void> {
    this.quitting = true
    this.killChild()
  }

  // Kill a stale process from a prior Orca run recorded in the pidfile.
  reapOrphan(): void {
    const pidFile = getCodeServerPidFilePath()
    if (!existsSync(pidFile)) {
      return
    }
    try {
      const pid = Number(readFileSync(pidFile, 'utf8').trim())
      if (Number.isInteger(pid) && pid > 0) {
        process.kill(pid, 'SIGTERM')
      }
    } catch {
      // process already gone or not ours; ignore
    } finally {
      try {
        rmSync(pidFile, { force: true })
      } catch {
        // best effort
      }
    }
  }
}
