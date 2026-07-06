import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import {
  CODE_SERVER_VERSION,
  getCodeServerCacheRoot,
  resolveCodeServerExecutable,
  resolveCodeServerInstallScript
} from './code-server-paths'

export type InstallProgress = (fraction: number) => void

type InstallErrorCode =
  | 'missing-prereq'
  | 'unsupported-arch'
  | 'download-failed'
  | 'no-install-script'

export class CodeServerInstallError extends Error {
  readonly code: InstallErrorCode
  constructor(code: InstallErrorCode, message: string) {
    super(message)
    this.name = 'CodeServerInstallError'
    this.code = code
  }
}

let inFlight: Promise<string> | null = null

// Idempotent, single-flight ensure-installed. Runs the vendored install.sh with
// --method standalone (bundles its own Node — no system-Node dependency).
export function ensureCodeServerInstalled(onProgress?: InstallProgress): Promise<string> {
  const existing = resolveCodeServerExecutable()
  if (existing) {
    return Promise.resolve(existing)
  }
  if (inFlight) {
    return inFlight
  }
  inFlight = runInstall(onProgress).finally(() => {
    inFlight = null
  })
  return inFlight
}

async function runInstall(onProgress?: InstallProgress): Promise<string> {
  const script = resolveCodeServerInstallScript()
  if (!script) {
    throw new CodeServerInstallError('no-install-script', 'code-server installer not found.')
  }
  const prefix = getCodeServerCacheRoot()
  onProgress?.(0)

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(
      'sh',
      [script, '--method', 'standalone', '--prefix', prefix, '--version', CODE_SERVER_VERSION],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    )
    let stderr = ''
    // install.sh does not emit machine-readable progress; surface indeterminate
    // motion by nudging toward, but never reaching, completion.
    let ticks = 0
    child.stdout?.on('data', () => {
      ticks += 1
      onProgress?.(Math.min(0.9, ticks / 40))
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) =>
      reject(
        new CodeServerInstallError('missing-prereq', `Failed to run installer: ${err.message}`)
      )
    )
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      const message = stderr.trim() || `installer exited with code ${code}`
      // install.sh's real sentinel for an unsupported CPU arch (i686, armv7l, riscv64, s390x, ...)
      // is "no standalone releases for $ARCH" — none of those values contain "arch" itself.
      const errorCode: InstallErrorCode = /no standalone releases for/i.test(message)
        ? 'unsupported-arch'
        : /curl|tar|wget|command not found/i.test(message)
          ? 'missing-prereq'
          : 'download-failed'
      reject(new CodeServerInstallError(errorCode, message))
    })
  }).catch(async (err) => {
    // Clean up a partial install so the next attempt starts fresh.
    await rm(prefix, { recursive: true, force: true }).catch(() => {})
    throw err
  })

  // macOS: strip the quarantine attribute so the bundled binary can execute.
  if (process.platform === 'darwin') {
    await new Promise<void>((resolvePromise) => {
      const xattr = spawn('xattr', ['-dr', 'com.apple.quarantine', prefix], { windowsHide: true })
      xattr.on('error', () => resolvePromise())
      xattr.on('close', () => resolvePromise())
    })
  }

  onProgress?.(1)
  const exe = resolveCodeServerExecutable()
  if (!exe) {
    // Mirror the spawn-failure cleanup so a botched install doesn't wedge future retries.
    await rm(prefix, { recursive: true, force: true }).catch(() => {})
    throw new CodeServerInstallError('download-failed', 'code-server missing after install.')
  }
  return exe
}
