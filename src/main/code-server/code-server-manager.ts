import { spawn, type ChildProcess } from 'node:child_process'
import { net } from 'electron'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import type { CodeServerStatus, CodeServerStatusEvent } from '../../shared/code-server-types'
import { hydrateShellPath, mergePathSegments } from '../startup/hydrate-shell-path'
import { promoteVersionManagerShims } from './code-server-toolchain-path'
import type { CodeServerProfile } from './code-server-profile'
import {
  killWindowsCodeServerTree,
  reapWindowsCodeServerOrphan,
  type WindowsCodeServerTerminationDeps
} from './code-server-windows-termination'

// Per-attempt readiness cap. Warm starts are near-instant; a cold start
// (unsigned binary + bundled Node incurring one-time macOS Gatekeeper scanning
// and first-run cache building) is slower but the OS caches that work, so a
// force-killed slow first attempt is re-spawned once (see startProcessWithOneRetry)
// and the retry hits the warm cache. Kept short so a genuinely stuck start
// surfaces to the user quickly instead of hanging.
const READY_TIMEOUT_MS = 10_000
const READY_POLL_MS = 200
// Cap retained stderr so a chatty code-server can't grow this unbounded while running.
const STDERR_TAIL_MAX_BYTES = 8 * 1024

async function waitForReadiness(
  port: number,
  probePath: string,
  isChildAlive: () => boolean
): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() <= deadline) {
    // Stop immediately if the process died during startup — the wait would
    // otherwise burn the full cap polling a port nothing is listening on.
    if (!isChildAlive()) {
      return false
    }
    const ok = await probeReadiness(port, probePath)
    if (ok) {
      return true
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS))
  }
  return false
}

function probeReadiness(port: number, probePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = net.request(`http://127.0.0.1:${port}${probePath}`)
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
  restartForConfigChange(): Promise<{ port: number } | null>
  release(): void
  getStatus(): CodeServerStatusEvent
  onStatusChanged(cb: (e: CodeServerStatusEvent) => void): () => void
  shutdown(): Promise<void>
}

export type CodeServerManagerDeps = WindowsCodeServerTerminationDeps & {
  platform?: NodeJS.Platform
}

export class CodeServerManager implements CodeServerProvider {
  private child: ChildProcess | null = null
  private port: number | null = null
  private refCount = 0
  private quitting = false
  // Reachable 'not-installed' start state (fix: was hardcoded 'stopped', hiding the
  // real state machine's entry point from callers that check status before acquire()).
  private status: CodeServerStatus
  private errorMessage: string | undefined
  private readonly listeners = new Set<(e: CodeServerStatusEvent) => void>()
  // Single-flight guard: overlapping acquire() calls before the first reaches 'ready'
  // must share one start sequence, or each spawns its own untracked child process.
  private starting: Promise<{ port: number }> | null = null

  constructor(
    private readonly profile: CodeServerProfile,
    private readonly deps: CodeServerManagerDeps = {}
  ) {
    this.status = profile.resolveInstalled() ? 'stopped' : 'not-installed'
  }

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

  // Restart a running server so config imported while it was up (extensions,
  // a different source editor's settings) is picked up. Does NOT take a ref —
  // the panes' existing refs keep driving the lifetime. When nothing is
  // running, the next acquire reads the new config anyway, so this no-ops.
  async restartForConfigChange(): Promise<{ port: number } | null> {
    if (this.starting) {
      await this.starting.catch(() => {}) // let an in-flight start settle first
    }
    if (!this.child || this.refCount <= 0) {
      return null
    }
    void this.killChild()
    this.starting = this.startSequence().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async startSequence(): Promise<{ port: number }> {
    try {
      await this.reapOrphan()
      // Only pass through 'installing' when an install will actually happen —
      // otherwise a normal start flashes "installing 0%" for an already-installed binary.
      if (!this.profile.resolveInstalled()) {
        this.emit('installing', { progress: 0 })
        await this.profile.ensureInstalled((fraction) =>
          this.emit('installing', { progress: fraction })
        )
      }
      await this.profile.prepare()
      const port = await this.startProcessWithOneRetry()
      return { port }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.emit('error', { error: message })
      throw error
    }
  }

  // One automatic retry before surfacing an error. A slow first start is
  // force-killed at the shorter READY_TIMEOUT_MS; a fresh spawn then hits the
  // now-warm binary cache (macOS Gatekeeper scan, first-run cache) and usually
  // succeeds. This mirrors the manual Retry button's re-drive, so the user only
  // lands on the error state after two failed attempts. startProcess re-emits
  // 'starting' on the retry, so the UI stays on the loader rather than flashing.
  private async startProcessWithOneRetry(): Promise<number> {
    try {
      return await this.startProcess()
    } catch {
      return await this.startProcess()
    }
  }

  private platform(): NodeJS.Platform {
    return this.deps.platform ?? process.platform
  }

  private async startProcess(): Promise<number> {
    const port = await this.profile.allocatePort()
    const { command, args, env: spawnEnvOverrides } = this.profile.buildSpawn(port, this.platform())
    this.emit('starting')
    // Extensions in the embedded editor shell out to the user's toolchain
    // (e.g. rubocop runs `bundle list`), which needs the login-shell PATH so
    // version-manager tools resolve the same way the user's terminal does. A
    // GUI-launched Orca inherits launchd's sparse PATH, so hydrate it (memoized)
    // first. Windows has no POSIX login shell; hydrateShellPath no-ops there.
    const hydration = await hydrateShellPath()
    if (hydration.ok) {
      mergePathSegments(hydration.segments)
    }
    // The shared extension host serves every worktree and never re-runs the
    // shell's per-directory hook, so promote version-manager shims ahead of the
    // shell-activated resolved-version dirs — otherwise a worktree pinning a
    // non-default Ruby/Node runs the wrong one. POSIX-only concern.
    //
    // VSCODE_CLI=1 stops the server from re-probing the user's login shell to
    // build the extension host's environment; that probe would otherwise
    // overwrite our shims-promoted PATH with the mise/asdf-activated one
    // (installs/<tool>/latest ahead of shims), re-breaking per-worktree tool
    // resolution. code-server's CLI rejects the equivalent --force-disable-user-env
    // flag, but the server honors this env var. Windows already skips the probe.
    const spawnEnv =
      this.platform() === 'win32'
        ? { ...process.env, ...spawnEnvOverrides }
        : {
            ...process.env,
            VSCODE_CLI: '1',
            PATH: promoteVersionManagerShims(process.env.PATH),
            ...spawnEnvOverrides
          }
    // profile.buildSpawn returns a real executable on every platform (Windows
    // spawns the package's bundled node.exe against entry.js — never a .cmd),
    // so no shell and no windows-batch-spawn routing is needed.
    const child = spawn(command, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      env: spawnEnv
    })
    this.child = child
    this.port = port
    writeFileSync(this.profile.pidFilePath, String(child.pid ?? ''))
    // Publish the pid so the memory collector can attribute the editor's whole
    // process subtree (extension host, LSPs, ripgrep) to Orca's footprint.
    this.profile.onPidChanged(child.pid ?? null)
    let exited = false
    child.on('exit', () => {
      exited = true
      this.handleUnexpectedExit()
    })

    let stderrTail = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_MAX_BYTES)
    })

    const ready = await waitForReadiness(port, this.profile.readinessProbePath, () => !exited)
    if (!ready) {
      void this.killChild()
      const detail = stderrTail.trim()
      throw new Error(
        detail
          ? `The workbench server did not become ready in time: ${detail}`
          : 'The workbench server did not become ready in time'
      )
    }
    this.emit('ready')
    return port
  }

  private handleUnexpectedExit(): void {
    this.child = null
    this.port = null
    this.profile.onPidChanged(null)
    // An exit before the server ever reached 'ready' is a failed start: the
    // awaiting startProcess() reports it as an error, so don't auto-restart
    // here (which would race that caller and can loop). Only a server that
    // had gone healthy and later crashed should be revived.
    if (this.status !== 'ready') {
      return
    }
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
      void this.killChild()
      this.emit('stopped')
    }
  }

  private killChild(): Promise<void> {
    const child = this.child
    this.child = null
    this.port = null
    this.profile.onPidChanged(null)
    let treeKill: Promise<void> = Promise.resolve()
    if (child && !child.killed) {
      child.removeAllListeners('exit')
      if (this.platform() === 'win32' && child.pid) {
        // SIGTERM on Windows kills only the root node.exe; take the whole
        // editor tree (extension host, LSPs, ripgrep) via taskkill /T /F.
        treeKill = killWindowsCodeServerTree(child.pid, this.deps).finally(() => {
          try {
            child.kill()
          } catch {
            // already gone
          }
        })
      } else {
        child.kill('SIGTERM')
      }
    }
    try {
      rmSync(this.profile.pidFilePath, { force: true })
    } catch {
      // best effort
    }
    return treeKill
  }

  async shutdown(): Promise<void> {
    this.quitting = true
    // Await the Windows tree kill so quit doesn't outrun taskkill (bounded by
    // its own 5s timeout); POSIX resolves immediately.
    await this.killChild()
  }

  // Kill a stale process from a prior Orca run recorded in the pidfile.
  async reapOrphan(): Promise<void> {
    const pidFile = this.profile.pidFilePath
    if (!existsSync(pidFile)) {
      return
    }
    try {
      const pid = Number(readFileSync(pidFile, 'utf8').trim())
      if (Number.isInteger(pid) && pid > 0) {
        if (this.platform() === 'win32') {
          // Identity-gated: the PID may have been recycled since that run died,
          // so only a process provably running our install gets tree-killed.
          await reapWindowsCodeServerOrphan(pid, this.profile.installRoot, this.deps)
        } else {
          process.kill(pid, 'SIGTERM')
        }
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
