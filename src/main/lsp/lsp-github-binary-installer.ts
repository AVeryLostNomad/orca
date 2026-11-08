import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { LspServerId } from '../../shared/lsp-types'
import { LspInstallError } from './lsp-artifact-download'
import { lspServerInstallDir } from './lsp-install-paths'
import { ensurePinnedArchiveInstalled } from './lsp-pinned-archive-installer'
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

/** Download + verify + extract a pinned prebuilt server binary. Returns the
 *  absolute executable path. */
export function ensureLspBinaryInstalled(
  serverId: LspServerId,
  onProgress: (fraction: number) => void
): Promise<string> {
  const resolved = lspBinaryAssetForCurrentPlatform(serverId)
  if (!resolved) {
    return Promise.reject(
      new LspInstallError(
        `no pinned ${serverId} binary for ${platformKey()} (config/lsp-binary-assets.json)`
      )
    )
  }
  const { pin, asset } = resolved
  return ensurePinnedArchiveInstalled(
    {
      key: serverId,
      url: asset.url,
      hash: { algorithm: 'sha256', digest: asset.sha256 },
      archive: asset.archive,
      payloadRelativePath: asset.binaryRelativePath,
      executable: true,
      installRoot: lspServerInstallDir(serverId, pin.version)
    },
    onProgress
  )
}
