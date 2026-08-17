import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { get } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { join } from 'node:path'
import { CodeServerInstallError, type InstallProgress } from './code-server-install-error'
import {
  CODE_SERVER_VERSION,
  getCodeServerCacheRoot,
  getCodeServerVersionRoot
} from './code-server-paths'
import {
  CODE_SERVER_WINDOWS_ASSET_NAME,
  CODE_SERVER_WINDOWS_DOWNLOAD_URL,
  CODE_SERVER_WINDOWS_MIN_VALID_BYTES,
  CODE_SERVER_WINDOWS_SHA256
} from './code-server-windows-package'

export type WindowsInstallDeps = {
  execFileImpl?: typeof execFile
  downloadImpl?: (
    url: string,
    dest: string,
    onBytes?: (received: number, total: number | null) => void
  ) => Promise<void>
  env?: NodeJS.ProcessEnv
}

// Progress budget: download dominates wall time, extraction is local and fast.
const DOWNLOAD_PROGRESS_END = 0.8
const EXTRACT_PROGRESS = 0.95
const DOWNLOAD_STALL_TIMEOUT_MS = 30_000

// Install the CI-built Windows code-server package (coder publishes no Windows
// release) into the same lib/code-server-<version> layout install.sh produces
// on POSIX. Download → sha256-verify → extract → rename into place; every
// failure path cleans up so a retry starts fresh.
export async function installCodeServerWindows(
  onProgress?: InstallProgress,
  deps: WindowsInstallDeps = {}
): Promise<void> {
  if (!CODE_SERVER_WINDOWS_SHA256) {
    // The pin is filled from the package workflow's output when a version is
    // first published; refusing here means a bump can never ship unpinned.
    throw new CodeServerInstallError(
      'download-failed',
      'Windows code-server package has no checksum pin for this build.'
    )
  }
  const cacheRoot = getCodeServerCacheRoot()
  const downloadsDir = join(cacheRoot, 'downloads')
  const partialPath = join(downloadsDir, `${CODE_SERVER_WINDOWS_ASSET_NAME}.partial`)
  const zipPath = join(downloadsDir, CODE_SERVER_WINDOWS_ASSET_NAME)
  // Staging lives under cacheRoot so the final rename never crosses volumes
  // (EXDEV) — the installer's POSIX cp fallback must stay unreachable here.
  const stagingDir = join(cacheRoot, 'lib', `.staging-${CODE_SERVER_VERSION}`)
  const versionRoot = getCodeServerVersionRoot()

  const cleanup = async (): Promise<void> => {
    for (const target of [partialPath, zipPath, stagingDir, versionRoot]) {
      await rm(target, { recursive: true, force: true }).catch(() => {})
    }
  }

  try {
    onProgress?.(0)
    await mkdir(downloadsDir, { recursive: true })
    await rm(partialPath, { force: true }).catch(() => {})
    const download = deps.downloadImpl ?? downloadTo
    await download(CODE_SERVER_WINDOWS_DOWNLOAD_URL, partialPath, (received, total) => {
      if (total && total > 0) {
        onProgress?.(Math.min(DOWNLOAD_PROGRESS_END, (received / total) * DOWNLOAD_PROGRESS_END))
      }
    }).catch((error: unknown) => {
      throw new CodeServerInstallError(
        'download-failed',
        `Could not download code-server: ${error instanceof Error ? error.message : String(error)}`
      )
    })

    const size = (await stat(partialPath).catch(() => null))?.size ?? 0
    if (size < CODE_SERVER_WINDOWS_MIN_VALID_BYTES) {
      throw new CodeServerInstallError(
        'download-failed',
        `Downloaded code-server package is truncated (${size} bytes).`
      )
    }
    const digest = await sha256File(partialPath)
    if (digest !== CODE_SERVER_WINDOWS_SHA256) {
      throw new CodeServerInstallError(
        'checksum-mismatch',
        `code-server package checksum mismatch: expected ${CODE_SERVER_WINDOWS_SHA256}, got ${digest}.`
      )
    }
    await rm(zipPath, { force: true }).catch(() => {})
    await rename(partialPath, zipPath)
    onProgress?.(DOWNLOAD_PROGRESS_END + 0.05)

    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    await mkdir(stagingDir, { recursive: true })
    await extractZip(zipPath, stagingDir, deps)
    onProgress?.(EXTRACT_PROGRESS)

    // The zip carries a single versioned top-level dir (built by
    // config/scripts/build-code-server-windows-package.mjs); locate it rather
    // than hardcoding, so an arch-suffix change can't silently break installs.
    const entries = await readdir(stagingDir, { withFileTypes: true })
    const packageDir = entries.find((e) => e.isDirectory() && e.name.startsWith('code-server-'))
    if (!packageDir) {
      throw new CodeServerInstallError(
        'download-failed',
        'code-server package zip had an unexpected layout.'
      )
    }
    await rm(versionRoot, { recursive: true, force: true }).catch(() => {})
    await rename(join(stagingDir, packageDir.name), versionRoot)

    await rm(zipPath, { force: true }).catch(() => {})
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
  } catch (error) {
    await cleanup()
    throw error instanceof CodeServerInstallError
      ? error
      : new CodeServerInstallError(
          'download-failed',
          `Failed to install code-server: ${error instanceof Error ? error.message : String(error)}`
        )
  }
}

// System32's bsdtar handles zip; absolute path dodges PATH hijack and argv
// spawning keeps spaced paths (C:\Users\First Last\...) safe with no shell.
// PowerShell Expand-Archive is the fallback for hosts missing tar.exe (< Win10 1803).
async function extractZip(
  zipPath: string,
  destDir: string,
  deps: WindowsInstallDeps
): Promise<void> {
  const env = deps.env ?? process.env
  const tarExe = join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  const tarResult = await runExtractor(tarExe, ['-xf', zipPath, '-C', destDir], deps)
  if (tarResult.ok) {
    return
  }
  const psCommand = [
    "$ErrorActionPreference = 'Stop'",
    `Expand-Archive -LiteralPath ${quotePowerShellLiteral(zipPath)} -DestinationPath ${quotePowerShellLiteral(destDir)} -Force`
  ].join('; ')
  const psResult = await runExtractor(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psCommand],
    deps
  )
  if (!psResult.ok) {
    throw new CodeServerInstallError(
      'missing-prereq',
      `Could not extract code-server package: ${psResult.detail || tarResult.detail || 'no extractor available'}`
    )
  }
}

function runExtractor(
  file: string,
  args: string[],
  deps: WindowsInstallDeps
): Promise<{ ok: boolean; detail: string }> {
  const run = deps.execFileImpl ?? execFile
  return new Promise((resolve) => {
    run(file, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (!error) {
        resolve({ ok: true, detail: '' })
        return
      }
      resolve({ ok: false, detail: String(stderr ?? '').trim() || error.message })
    })
  })
}

function quotePowerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

// GitHub release downloads 302-redirect to the asset CDN; follow https-only.
// Mirrors src/main/emulator/android/scrcpy-server-download.ts, plus byte
// progress from Content-Length.
function downloadTo(
  url: string,
  dest: string,
  onBytes?: (received: number, total: number | null) => void,
  redirects = 0
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error('too many redirects'))
      return
    }
    const req = get(url, (res: IncomingMessage) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url)
        if (next.protocol !== 'https:') {
          res.resume()
          reject(new Error(`refusing non-https redirect to ${next.protocol}`))
          return
        }
        res.resume()
        downloadTo(next.toString(), dest, onBytes, redirects + 1).then(resolve, reject)
        return
      }
      if (status !== 200) {
        res.resume()
        reject(new Error(`HTTP ${status}`))
        return
      }
      const totalHeader = Number(res.headers['content-length'])
      const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : null
      let received = 0
      res.on('data', (chunk: Buffer) => {
        received += chunk.length
        onBytes?.(received, total)
      })
      const out = createWriteStream(dest)
      out.on('error', reject)
      out.on('finish', resolve)
      res.on('error', reject)
      res.pipe(out)
    })
    req.on('error', reject)
    req.setTimeout(DOWNLOAD_STALL_TIMEOUT_MS, () => req.destroy(new Error('download timed out')))
  })
}
