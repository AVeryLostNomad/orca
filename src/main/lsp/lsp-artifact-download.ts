import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, mkdirSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createGunzip } from 'node:zlib'
import { isAbsolute, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { net } from 'electron'
import { tarExecutable } from '../data-studio/ads-server-installer'

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

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

export async function assertSha256(path: string, expected: string): Promise<void> {
  const actual = await sha256File(path)
  if (actual !== expected.toLowerCase()) {
    throw new LspInstallError(`sha256 mismatch for ${path}: expected ${expected}, got ${actual}`)
  }
}

export function extractTarGz(archive: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    mkdirSync(destination, { recursive: true })
    const child = spawn(tarExecutable(), ['-xzf', archive, '-C', destination], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true
    })
    let stderrTail = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2048)
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new LspInstallError(`tar exited with ${code}: ${stderrTail.trim()}`))
      }
    })
  })
}

// System32 bsdtar handles zip too, with PowerShell Expand-Archive as fallback
// (mirrors code-server-windows-install).
export function extractZip(archive: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    mkdirSync(destination, { recursive: true })
    const runTar = (): void => {
      const child = spawn(tarExecutable(), ['-xf', archive, '-C', destination], {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true
      })
      let stderrTail = ''
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-2048)
      })
      child.on('error', (error) => {
        if (process.platform === 'win32') {
          runPowershellFallback()
        } else {
          reject(error)
        }
      })
      child.on('exit', (code) => {
        if (code === 0) {
          resolve()
        } else if (process.platform === 'win32') {
          runPowershellFallback()
        } else {
          reject(new LspInstallError(`tar exited with ${code}: ${stderrTail.trim()}`))
        }
      })
    }
    const runPowershellFallback = (): void => {
      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Expand-Archive -LiteralPath "${archive}" -DestinationPath "${destination}" -Force`
        ],
        { stdio: 'ignore', windowsHide: true }
      )
      child.on('error', reject)
      child.on('exit', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new LspInstallError(`Expand-Archive exited with ${code}`))
        }
      })
    }
    runTar()
  })
}

export async function gunzipFile(archive: string, destination: string): Promise<void> {
  await pipeline(createReadStream(archive), createGunzip(), createWriteStream(destination))
}
