import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { net } from 'electron'
import { getAdsServerRoot, resolveAdsServerEntry } from './ads-server'

// Prebuilt Azure Data Studio web-server artifact, produced by
// resources/data-studio/package-ads-server.sh from the (archived, read-only)
// microsoft/azuredatastudio source plus resources/data-studio/ads-orca-web-server.patch.
// Published as a GitHub release asset on a public repo so the install is a
// plain unauthenticated download — no toolchain needed on user machines.
// Why the fork, not stablyai/orca: releases require push permission there.
export const ADS_SERVER_RELEASE_TAG = 'ads-web-server-v1.53.0-orca.1'
const ADS_SERVER_VERSION = '1.53.0-orca.1'
const DOWNLOAD_BASE =
  process.env.ORCA_ADS_SERVER_DOWNLOAD_BASE ??
  `https://github.com/AVeryLostNomad/orca/releases/download/${ADS_SERVER_RELEASE_TAG}`

export class AdsServerInstallError extends Error {}

function assetNameForPlatform(): string | null {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null
  if (!arch) {
    return null
  }
  if (process.platform === 'darwin') {
    return `ads-web-server-${ADS_SERVER_VERSION}-darwin-${arch}.tar.gz`
  }
  // linux-arm64 has no artifact: ADS never shipped Linux ARM64 and its
  // tools-service downloader cannot identify the platform at runtime.
  if (process.platform === 'linux' && arch === 'x64') {
    return `ads-web-server-${ADS_SERVER_VERSION}-linux-x64.tar.gz`
  }
  // Windows-on-ARM has no ADS toolchain; x64 only. Extraction relies on the
  // tar.exe (bsdtar) that ships with Windows 10 1803+.
  if (process.platform === 'win32' && arch === 'x64') {
    return `ads-web-server-${ADS_SERVER_VERSION}-win32-x64.tar.gz`
  }
  return null
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
        reject(new AdsServerInstallError(`download failed with HTTP ${response.statusCode}`))
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

function extractTarGz(archive: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    mkdirSync(destination, { recursive: true })
    const child = spawn('tar', ['-xzf', archive, '-C', destination], {
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
        reject(new AdsServerInstallError(`tar exited with ${code}: ${stderrTail.trim()}`))
      }
    })
  })
}

let inFlight: Promise<void> | null = null

/** Download + extract the prebuilt ADS web server (single-flight, atomic
 *  rename into place). Progress: 0..0.85 download, 0.85..1 extract. */
export async function ensureAdsServerInstalled(
  onProgress: (fraction: number) => void
): Promise<void> {
  if (resolveAdsServerEntry()) {
    return
  }
  if (!inFlight) {
    inFlight = install(onProgress).finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

async function install(onProgress: (fraction: number) => void): Promise<void> {
  const asset = assetNameForPlatform()
  if (!asset) {
    throw new AdsServerInstallError(
      `no prebuilt Azure Data Studio server for ${process.platform}/${process.arch}; ` +
        'build it with resources/data-studio/install-ads-server.sh'
    )
  }
  const root = getAdsServerRoot()
  const parent = dirname(root)
  mkdirSync(parent, { recursive: true })
  const archivePath = join(parent, `${asset}.partial`)
  const extractDir = join(parent, '.ads-extract-tmp')
  rmSync(archivePath, { force: true })
  rmSync(extractDir, { recursive: true, force: true })
  try {
    await downloadToFile(`${DOWNLOAD_BASE}/${asset}`, archivePath, (fraction) =>
      onProgress(fraction * 0.85)
    )
    onProgress(0.85)
    await extractTarGz(archivePath, extractDir)
    onProgress(0.98)
    // The archive contains a single top-level `ads/` directory.
    const extractedRoot = join(extractDir, 'ads')
    if (!existsSync(join(extractedRoot, 'out', 'server-main.js'))) {
      throw new AdsServerInstallError('archive did not contain ads/out/server-main.js')
    }
    rmSync(root, { recursive: true, force: true })
    renameSync(extractedRoot, root)
    onProgress(1)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new AdsServerInstallError(
      `Could not install the Azure Data Studio server: ${message}. ` +
        'Fallback: build from source with resources/data-studio/install-ads-server.sh'
    )
  } finally {
    rmSync(archivePath, { force: true })
    rmSync(extractDir, { recursive: true, force: true })
  }
}
