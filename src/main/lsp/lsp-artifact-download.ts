import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, mkdirSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { createGunzip } from 'node:zlib'
import { isAbsolute, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { net } from 'electron'
import { spawnProcess } from '@orca/process-host'
import { tarExecutable } from '../data-studio/ads-server-installer'
import { trySpawnOffWindowsMainThread } from '../worker-thread-child-process/windows-main-thread-spawn-offload'
import type { ChildProcessHandle } from '@orca/process-host/process-spec'
import type { WorkerThreadChildProcess } from '../worker-thread-child-process/worker-thread-child-process'

type ArchiveToolChild = ChildProcessHandle | WorkerThreadChildProcess

export class LspInstallError extends Error {}

/** A download base can be a URL or (for tests/dev) a local directory. */
export function isLocalDownloadBase(base: string): boolean {
  return isAbsolute(base) || /^[A-Za-z]:[\\/]/.test(base)
}

export async function fetchLspArtifact(
  base: string,
  asset: string,
  destination: string,
  onProgress: (fraction: number) => void
): Promise<void> {
  if (isLocalDownloadBase(base)) {
    await copyFile(join(base, asset), destination)
    onProgress(1)
    return
  }
  await downloadToFile(`${base}/${asset}`, destination, onProgress)
}

function downloadToFile(
  url: string,
  destination: string,
  onProgress: (fraction: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = net.request({
      url,
      redirect: 'follow'
    } as Electron.ClientRequestConstructorOptions)
    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        response.on('data', () => {})
        reject(new LspInstallError(`download failed with HTTP ${response.statusCode}: ${url}`))
        return
      }
      const total = Number(response.headers['content-length'] ?? 0)
      let received = 0
      const file = createWriteStream(destination)
      response.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (total > 0) {
          onProgress(received / total)
        }
        file.write(chunk)
      })
      response.on('end', () => file.end(() => resolve()))
      response.on('error', (error: Error) => {
        file.destroy()
        reject(error)
      })
    })
    request.on('error', reject)
    request.end()
  })
}

export type LspArtifactHashAlgorithm = 'sha256' | 'sha512'

function hashFile(path: string, algorithm: LspArtifactHashAlgorithm): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>()
  const hash = createHash(algorithm)
  const stream = createReadStream(path)
  stream.on('data', (chunk) => hash.update(chunk))
  stream.on('end', () => resolve(hash.digest('hex')))
  stream.on('error', reject)
  return promise
}

export async function assertFileHash(
  path: string,
  algorithm: LspArtifactHashAlgorithm,
  expected: string
): Promise<void> {
  const actual = await hashFile(path, algorithm)
  if (actual !== expected.toLowerCase()) {
    throw new LspInstallError(
      `${algorithm} mismatch for ${path}: expected ${expected}, got ${actual}`
    )
  }
}

// Installs extract on the main process; Windows main-thread spawns can stall ~5s.
function spawnArchiveTool(program: string, args: string[]): ArchiveToolChild {
  const spec = { program, args }
  const child =
    trySpawnOffWindowsMainThread(spec) ??
    spawnProcess({ ...spec, stdio: ['pipe', 'ignore', 'pipe'] })
  child.stdin?.end()
  return child
}

function collectStderrTail(child: ArchiveToolChild): () => string {
  let stderrTail = ''
  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-2048)
  })
  return () => stderrTail.trim()
}

export function extractTarGz(
  archive: string,
  destination: string,
  options?: { excludePatterns?: string[] }
): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  mkdirSync(destination, { recursive: true })
  const excludeArgs = (options?.excludePatterns ?? []).flatMap((pattern) => ['--exclude', pattern])
  const child = spawnArchiveTool(tarExecutable(), [
    '-xzf',
    archive,
    '-C',
    destination,
    ...excludeArgs
  ])
  const stderrTail = collectStderrTail(child)
  child.on('error', reject)
  child.on('exit', (code: number | null) => {
    if (code === 0) {
      resolve()
    } else {
      reject(new LspInstallError(`tar exited with ${code}: ${stderrTail()}`))
    }
  })
  return promise
}

// System32 bsdtar handles zip too, with PowerShell Expand-Archive as fallback
// (mirrors code-server-windows-install).
export function extractZip(archive: string, destination: string): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  mkdirSync(destination, { recursive: true })
  const runPowershellFallback = (): void => {
    // Single-quoted literals: `$` and backticks in profile paths stay inert.
    const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`
    const child = spawnArchiveTool('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath ${literal(archive)} -DestinationPath ${literal(destination)} -Force`
    ])
    child.on('error', reject)
    child.on('exit', (code: number | null) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new LspInstallError(`Expand-Archive exited with ${code}`))
      }
    })
  }
  const child = spawnArchiveTool(tarExecutable(), ['-xf', archive, '-C', destination])
  const stderrTail = collectStderrTail(child)
  child.on('error', (error: Error) => {
    if (process.platform === 'win32') {
      runPowershellFallback()
    } else {
      reject(error)
    }
  })
  child.on('exit', (code: number | null) => {
    if (code === 0) {
      resolve()
    } else if (process.platform === 'win32') {
      runPowershellFallback()
    } else {
      reject(new LspInstallError(`tar exited with ${code}: ${stderrTail()}`))
    }
  })
  return promise
}

export async function gunzipFile(archive: string, destination: string): Promise<void> {
  await pipeline(createReadStream(archive), createGunzip(), createWriteStream(destination))
}
