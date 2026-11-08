import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  LspInstallError,
  assertFileHash,
  extractTarGz,
  extractZip,
  fetchLspArtifact,
  gunzipFile,
  isLocalDownloadBase,
  type LspArtifactHashAlgorithm
} from './lsp-artifact-download'
import { lspDownloadStagingDir } from './lsp-install-paths'

type LspPinnedArchive = {
  /** Unique staging name, e.g. the server id. */
  key: string
  url: string
  hash: { algorithm: LspArtifactHashAlgorithm; digest: string }
  archive: 'tar.gz' | 'zip' | 'gz' | 'none'
  /** File that must exist after extraction; the destination for 'gz'/'none'. */
  payloadRelativePath: string
  /** Mark the payload executable on POSIX. */
  executable: boolean
  installRoot: string
}

const inFlight = new Map<string, Promise<string>>()

/** Download + verify + extract a pinned archive into `installRoot` (single-flight
 *  per install root, atomic rename into place). Returns the payload path. */
export function ensurePinnedArchiveInstalled(
  pin: LspPinnedArchive,
  onProgress: (fraction: number) => void
): Promise<string> {
  const payload = join(pin.installRoot, ...pin.payloadRelativePath.split('/'))
  if (existsSync(payload)) {
    return Promise.resolve(payload)
  }
  let pending = inFlight.get(pin.installRoot)
  if (!pending) {
    pending = install(pin, onProgress).finally(() => {
      inFlight.delete(pin.installRoot)
    })
    inFlight.set(pin.installRoot, pending)
  }
  return pending
}

async function install(
  pin: LspPinnedArchive,
  onProgress: (fraction: number) => void
): Promise<string> {
  mkdirSync(dirname(pin.installRoot), { recursive: true })
  const staging = lspDownloadStagingDir()
  mkdirSync(staging, { recursive: true })
  const assetName = basename(new URL(pin.url, 'https://invalid.local/').pathname)
  // Expand-Archive (the Windows zip fallback) refuses anything not named .zip.
  const archivePath = join(
    staging,
    `${pin.key}-${assetName}.partial${pin.archive === 'zip' ? '.zip' : ''}`
  )
  const extractDir = join(staging, `.extract-${pin.key}`)
  rmSync(archivePath, { force: true })
  rmSync(extractDir, { recursive: true, force: true })
  try {
    // Test/dev override: ORCA_LSP_DOWNLOAD_BASE as a directory serves assets by
    // their basename; otherwise the pinned URL is fetched directly.
    const base = process.env.ORCA_LSP_DOWNLOAD_BASE
    const fetchBase = base && isLocalDownloadBase(base) ? base : dirname(pin.url)
    await fetchLspArtifact(fetchBase, assetName, archivePath, (fraction) =>
      onProgress(fraction * 0.8)
    )
    onProgress(0.8)
    await assertFileHash(archivePath, pin.hash.algorithm, pin.hash.digest)
    onProgress(0.85)
    mkdirSync(extractDir, { recursive: true })
    const payloadParts = pin.payloadRelativePath.split('/')
    if (pin.archive === 'tar.gz') {
      await extractTarGz(archivePath, extractDir)
    } else if (pin.archive === 'zip') {
      await extractZip(archivePath, extractDir)
    } else if (pin.archive === 'gz') {
      await gunzipFile(archivePath, join(extractDir, ...payloadParts))
    } else {
      renameSync(archivePath, join(extractDir, ...payloadParts))
    }
    onProgress(0.98)
    const extractedPayload = join(extractDir, ...payloadParts)
    if (!existsSync(extractedPayload)) {
      throw new LspInstallError(`archive did not contain ${pin.payloadRelativePath}`)
    }
    if (pin.executable && process.platform !== 'win32') {
      chmodSync(extractedPayload, 0o755)
    }
    rmSync(pin.installRoot, { recursive: true, force: true })
    renameSync(extractDir, pin.installRoot)
    onProgress(1)
    return join(pin.installRoot, ...payloadParts)
  } finally {
    rmSync(archivePath, { force: true })
    rmSync(extractDir, { recursive: true, force: true })
  }
}
