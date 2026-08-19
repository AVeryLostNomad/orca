import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  LspInstallError,
  assertSha256,
  extractTarGz,
  fetchLspArtifact
} from './lsp-artifact-download'
import { lspDownloadStagingDir, lspServerInstallDir } from './lsp-install-paths'
import { LSP_NODE_BUNDLE_RELEASE_TAG, lspNodeBundlePin } from './lsp-server-registry'

function downloadBase(): string {
  return (
    process.env.ORCA_LSP_DOWNLOAD_BASE ??
    `https://github.com/AVeryLostNomad/orca/releases/download/${LSP_NODE_BUNDLE_RELEASE_TAG}`
  )
}

const inFlight = new Map<string, Promise<string>>()

export function resolveInstalledLspNodeBundle(bundleId: string): string | null {
  const pin = lspNodeBundlePin(bundleId)
  if (!pin) {
    return null
  }
  const installRoot = lspServerInstallDir(bundleId, pin.version)
  return existsSync(join(installRoot, 'package.json')) ? installRoot : null
}

/** Download + verify + extract a prepacked Node server bundle (single-flight,
 *  atomic rename into place). Returns the install root. */
export function ensureLspNodeBundleInstalled(
  bundleId: string,
  onProgress: (fraction: number) => void
): Promise<string> {
  const installed = resolveInstalledLspNodeBundle(bundleId)
  if (installed) {
    return Promise.resolve(installed)
  }
  let pending = inFlight.get(bundleId)
  if (!pending) {
    pending = install(bundleId, onProgress).finally(() => {
      inFlight.delete(bundleId)
    })
    inFlight.set(bundleId, pending)
  }
  return pending
}

async function install(bundleId: string, onProgress: (fraction: number) => void): Promise<string> {
  const pin = lspNodeBundlePin(bundleId)
  if (!pin) {
    throw new LspInstallError(`no bundle pin for language server bundle "${bundleId}"`)
  }
  const installRoot = lspServerInstallDir(bundleId, pin.version)
  mkdirSync(dirname(installRoot), { recursive: true })
  const staging = lspDownloadStagingDir()
  mkdirSync(staging, { recursive: true })
  const archivePath = join(staging, `${pin.asset}.partial`)
  const extractDir = join(staging, `.extract-${bundleId}`)
  rmSync(archivePath, { force: true })
  rmSync(extractDir, { recursive: true, force: true })
  try {
    await fetchLspArtifact(downloadBase(), pin.asset, archivePath, (fraction) =>
      onProgress(fraction * 0.8)
    )
    onProgress(0.8)
    await assertSha256(archivePath, pin.sha256)
    onProgress(0.85)
    // npm .bin shims are symlinks Windows bsdtar can't create (exit 1); every
    // pinned entryRelativePath targets the real file, so skip them everywhere.
    await extractTarGz(archivePath, extractDir, { excludePatterns: ['*/.bin', '*/.bin/*'] })
    onProgress(0.98)
    if (!existsSync(join(extractDir, 'package.json'))) {
      throw new LspInstallError('bundle archive did not contain package.json')
    }
    rmSync(installRoot, { recursive: true, force: true })
    renameSync(extractDir, installRoot)
    onProgress(1)
    return installRoot
  } finally {
    rmSync(archivePath, { force: true })
    rmSync(extractDir, { recursive: true, force: true })
  }
}
