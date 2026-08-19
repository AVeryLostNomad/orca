import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { LspServerId, LspServerInstallState } from '../../shared/lsp-types'
import { LspInstallError } from './lsp-artifact-download'
import {
  ensureLspNodeBundleInstalled,
  resolveInstalledLspNodeBundle
} from './lsp-node-bundle-installer'
import {
  ensureLspBinaryInstalled,
  lspBinaryAssetForCurrentPlatform,
  lspBinaryServerPin,
  resolveInstalledLspBinary
} from './lsp-github-binary-installer'
import { resolveOrInstallGopls } from './lsp-user-toolchain-resolver'
import { getLspServerEntry, lspNodeBundlePin } from './lsp-server-registry'

export type LspSpawnSpec = {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  installRoot: string
}

const installStates = new Map<LspServerId, LspServerInstallState>()
const stateListeners = new Set<(serverId: LspServerId, state: LspServerInstallState) => void>()

export function onLspInstallStateChanged(
  listener: (serverId: LspServerId, state: LspServerInstallState) => void
): () => void {
  stateListeners.add(listener)
  return () => {
    stateListeners.delete(listener)
  }
}

function setInstallState(serverId: LspServerId, state: LspServerInstallState): void {
  installStates.set(serverId, state)
  for (const listener of stateListeners) {
    listener(serverId, state)
  }
}

export function getLspInstallState(serverId: LspServerId): LspServerInstallState {
  const tracked = installStates.get(serverId)
  if (tracked) {
    return tracked
  }
  const entry = getLspServerEntry(serverId)
  if (!entry) {
    return { phase: 'error', message: `unknown language server: ${serverId}` }
  }
  if (entry.acquisition.kind === 'node-bundle') {
    const pin = lspNodeBundlePin(entry.acquisition.bundleId)
    if (!pin) {
      return { phase: 'error', message: 'no pinned bundle for this server' }
    }
    return resolveInstalledLspNodeBundle(entry.acquisition.bundleId)
      ? { phase: 'installed', version: pin.version }
      : { phase: 'not-installed' }
  }
  if (entry.acquisition.kind === 'github-binary') {
    const pin = lspBinaryServerPin(serverId)
    if (!pin || !lspBinaryAssetForCurrentPlatform(serverId)) {
      return { phase: 'error', message: 'no pinned binary for this platform' }
    }
    return resolveInstalledLspBinary(serverId)
      ? { phase: 'installed', version: pin.version }
      : { phase: 'not-installed' }
  }
  return { phase: 'not-installed' }
}

const NODE_BUNDLE_ENV = { ELECTRON_RUN_AS_NODE: '1' } as const

/** Ensure the server payload is on disk (downloading on demand) and return how
 *  to spawn it. Throws LspInstallError with a user-facing message on failure. */
export async function ensureLspServerAvailable(serverId: LspServerId): Promise<LspSpawnSpec> {
  const entry = getLspServerEntry(serverId)
  if (!entry) {
    throw new LspInstallError(`unknown language server: ${serverId}`)
  }
  const onProgress = (fraction: number): void =>
    setInstallState(serverId, { phase: 'installing', progress: fraction })
  try {
    if (entry.acquisition.kind === 'node-bundle') {
      const { bundleId } = entry.acquisition
      const pin = lspNodeBundlePin(bundleId)
      const serverPin = pin?.servers[serverId]
      if (!pin || !serverPin) {
        throw new LspInstallError(`no pinned bundle for ${serverId}`)
      }
      const alreadyInstalled = resolveInstalledLspNodeBundle(bundleId) !== null
      const installRoot = await ensureLspNodeBundleInstalled(bundleId, onProgress)
      const entryAbsolute = join(installRoot, ...serverPin.entryRelativePath.split('/'))
      if (!existsSync(entryAbsolute)) {
        throw new LspInstallError(`bundle is missing ${serverPin.entryRelativePath}`)
      }
      if (!alreadyInstalled || installStates.get(serverId)?.phase !== 'installed') {
        setInstallState(serverId, { phase: 'installed', version: pin.version })
      }
      return {
        // Electron re-execs as plain Node, so bundles run without a user toolchain.
        command: process.execPath,
        args: [entryAbsolute, ...(serverPin.extraArgs ?? []), ...(entry.args ?? [])],
        env: { ...process.env, ...NODE_BUNDLE_ENV },
        installRoot
      }
    }
    if (entry.acquisition.kind === 'github-binary') {
      const pin = lspBinaryServerPin(serverId)
      if (!pin) {
        throw new LspInstallError(`no pinned binary for ${serverId}`)
      }
      const binaryPath = await ensureLspBinaryInstalled(serverId, onProgress)
      setInstallState(serverId, { phase: 'installed', version: pin.version })
      return {
        command: binaryPath,
        args: entry.args ?? [],
        env: { ...process.env },
        installRoot: join(binaryPath, '..')
      }
    }
    setInstallState(serverId, { phase: 'installing', progress: 0 })
    const gopls = await resolveOrInstallGopls()
    if (gopls.kind === 'toolchain-missing') {
      setInstallState(serverId, { phase: 'toolchain-missing', toolchain: 'go' })
      throw new LspInstallError('Go support requires a Go toolchain on PATH')
    }
    if (gopls.kind === 'install-failed') {
      setInstallState(serverId, { phase: 'error', message: gopls.message })
      throw new LspInstallError(`could not install gopls: ${gopls.message}`)
    }
    setInstallState(serverId, { phase: 'installed', version: 'toolchain' })
    return {
      command: gopls.command,
      args: entry.args ?? [],
      env: gopls.env,
      installRoot: join(gopls.command, '..')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const current = installStates.get(serverId)
    if (current?.phase !== 'toolchain-missing') {
      setInstallState(serverId, { phase: 'error', message })
    }
    throw error
  }
}

export function resetLspInstallErrorState(serverId: LspServerId): void {
  const current = installStates.get(serverId)
  if (current?.phase === 'error' || current?.phase === 'toolchain-missing') {
    installStates.delete(serverId)
  }
}
