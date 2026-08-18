import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { LspServerId } from '../../shared/lsp-types'
import {
  LspInstallError,
  assertSha256,
  extractTarGz,
  extractZip,
  fetchLspArtifact,
  gunzipFile,
  isLocalDownloadBase
} from './lsp-artifact-download'
import { lspDownloadStagingDir, lspServerInstallDir } from './lsp-install-paths'
import binaryAssetConfig from '../../../config/lsp-binary-assets.json'

type LspBinaryAssetPin = {
  url: string
  sha256: string
  archive: 'tar.gz' | 'zip' | 'gz' | 'none'
  binaryRelativePath: string
}

type LspBinaryServerPin = {
  version: string
  assets: Record<string, LspBinaryAssetPin>
}

function platformKey(): string {
  return `${process.platform}-${process.arch}`
}

export function lspBinaryServerPin(serverId: LspServerId): LspBinaryServerPin | undefined {
  const servers = binaryAssetConfig.servers as Record<string, LspBinaryServerPin>
  return servers[serverId]
}

export function lspBinaryAssetForCurrentPlatform(
  serverId: LspServerId
): { pin: LspBinaryServerPin; asset: LspBinaryAssetPin } | undefined {
  const pin = lspBinaryServerPin(serverId)
  const asset = pin?.assets[platformKey()]
  return pin && asset ? { pin, asset } : undefined
}

export function resolveInstalledLspBinary(serverId: LspServerId): string | null {
  const resolved = lspBinaryAssetForCurrentPlatform(serverId)
  if (!resolved) {
    return null
  }
  const binaryPath = join(
    lspServerInstallDir(serverId, resolved.pin.version),
    ...resolved.asset.binaryRelativePath.split('/')
  )
  return existsSync(binaryPath) ? binaryPath : null
}

const inFlight = new Map<string, Promise<string>>()

/** Download + verify + extract a pinned prebuilt server binary (single-flight,
 *  atomic rename into place). Returns the absolute executable path. */
export function ensureLspBinaryInstalled(
  serverId: LspServerId,
  onProgress: (fraction: number) => void
): Promise<string> {
  const installed = resolveInstalledLspBinary(serverId)
  if (installed) {
    return Promise.resolve(installed)
  }
  let pending = inFlight.get(serverId)
  if (!pending) {
    pending = install(serverId, onProgress).finally(() => {
      inFlight.delete(serverId)
    })
    inFlight.set(serverId, pending)
  }
  return pending
}

async function install(
  serverId: LspServerId,
  onProgress: (fraction: number) => void
): Promise<string> {
  const resolved = lspBinaryAssetForCurrentPlatform(serverId)
  if (!resolved) {
    throw new LspInstallError(
      `no pinned ${serverId} binary for ${platformKey()} (config/lsp-binary-assets.json)`
    )
  }
  const { pin, asset } = resolved
  const installRoot = lspServerInstallDir(serverId, pin.version)
  mkdirSync(dirname(installRoot), { recursive: true })
  const staging = lspDownloadStagingDir()
  mkdirSync(staging, { recursive: true })
  const assetName = basename(new URL(asset.url, 'https://invalid.local/').pathname)
  const archivePath = join(staging, `${serverId}-${assetName}.partial`)
  const extractDir = join(staging, `.extract-${serverId}`)
  rmSync(archivePath, { force: true })
  rmSync(extractDir, { recursive: true, force: true })
  try {
    // Test/dev override: ORCA_LSP_DOWNLOAD_BASE as a directory serves assets by
    // their basename; otherwise the pinned URL is fetched directly.
    const base = process.env.ORCA_LSP_DOWNLOAD_BASE
    const fetchBase = base && isLocalDownloadBase(base) ? base : dirname(asset.url)
    await fetchLspArtifact(fetchBase, assetName, archivePath, (fraction) =>
      onProgress(fraction * 0.8)
    )
    onProgress(0.8)
    await assertSha256(archivePath, asset.sha256)
    onProgress(0.85)
    mkdirSync(extractDir, { recursive: true })
    const binaryRelativeParts = asset.binaryRelativePath.split('/')
    if (asset.archive === 'tar.gz') {
      await extractTarGz(archivePath, extractDir)
    } else if (asset.archive === 'zip') {
      await extractZip(archivePath, extractDir)
    } else if (asset.archive === 'gz') {
      await gunzipFile(archivePath, join(extractDir, ...binaryRelativeParts))
    } else {
      renameSync(archivePath, join(extractDir, ...binaryRelativeParts))
    }
    onProgress(0.98)
    const extractedBinary = join(extractDir, ...binaryRelativeParts)
    if (!existsSync(extractedBinary)) {
      throw new LspInstallError(`archive did not contain ${asset.binaryRelativePath}`)
    }
    if (process.platform !== 'win32') {
      chmodSync(extractedBinary, 0o755)
    }
    rmSync(installRoot, { recursive: true, force: true })
    renameSync(extractDir, installRoot)
    onProgress(1)
    return join(installRoot, ...binaryRelativeParts)
  } finally {
    rmSync(archivePath, { force: true })
    rmSync(extractDir, { recursive: true, force: true })
  }
}
