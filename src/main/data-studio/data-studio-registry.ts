import { session } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { CodeServerManager } from '../code-server/code-server-manager'
import type { CodeServerProfile } from '../code-server/code-server-profile'
import type { CodeServerStatusEvent } from '../../shared/code-server-types'
import type {
  DataStudioEnsureRunningResult,
  DataStudioStatusEvent
} from '../../shared/data-studio-types'
import { setDataStudioPid } from '../code-server/code-server-process-registry'
import { browserSessionRegistry } from '../browser/browser-session-registry'
import {
  clearBrowserSessionPartitionPolicies,
  installBrowserSessionPartitionPolicies
} from '../browser/browser-session-partition-policies'
import { removeHostTree } from '../host-tree-removal'
import {
  ensureDataStudioProfileDir,
  getDataStudioExtensionsDir,
  getDataStudioPartition,
  getDataStudioProfileDir,
  getDataStudioProfilePidFilePath,
  getDataStudioProfilesRoot,
  getDataStudioProfileUserDataDir,
  hashRepoId
} from './data-studio-paths'
import { allocateStablePort, releaseStablePort } from './data-studio-ports'
import { applyDataStudioMachineSettings } from './data-studio-machine-settings'
import { buildAdsServerSpawn, getAdsServerRoot, resolveAdsServerEntry } from './ads-server'
import { ensureAdsServerInstalled } from './ads-server-installer'
import { repairAdsProductOverrides } from './ads-product-overrides'
import { getAdsImportDir, stageAdsDesktopImport } from './ads-desktop-import'

// Why: rename first so a quit mid-rm leaves a tombstone the next startup sweep finishes.
const PENDING_DELETE_DIR_NAME = '.pending-delete'

// One code-server process per repo: every worktree tab of a repo is a webview
// against the same origin (different ?folder=), so the repo's profile
// (connections, secret key half) is live-shared across its workspaces and
// invisible to other repos. Lifecycle per instance is the same refcounted
// CodeServerManager the editor uses — only the profile differs.
class DataStudioRegistry {
  private readonly instances = new Map<string, CodeServerManager>()
  private readonly createdPartitions = new Set<string>()
  private readonly listeners = new Set<(e: DataStudioStatusEvent) => void>()

  constructor() {
    // Fail-closed dynamic allowlist: will-attach-webview accepts a Data Studio
    // partition only after this registry created its instance (and installed
    // the partition's permission/download policies).
    browserSessionRegistry.registerExtraAllowedPartitionChecker((partition) =>
      this.createdPartitions.has(partition)
    )
  }

  onStatusChanged(cb: (e: DataStudioStatusEvent) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(repoId: string, event: CodeServerStatusEvent): void {
    for (const listener of this.listeners) {
      listener({ ...event, repoId })
    }
  }

  private getOrCreateInstance(repoId: string, repoPath: string | null): CodeServerManager {
    const existing = this.instances.get(repoId)
    if (existing) {
      return existing
    }
    ensureDataStudioProfileDir(repoId, repoPath)
    const partition = getDataStudioPartition(repoId)
    // Same permission/download hardening as browser sessions and the editor guest.
    installBrowserSessionPartitionPolicies({
      id: `datastudio:${hashRepoId(repoId)}`,
      scope: 'isolated',
      partition,
      label: 'Data Studio',
      source: null
    })
    this.createdPartitions.add(partition)
    const userDataDir = getDataStudioProfileUserDataDir(repoId)
    const extensionsDir = getDataStudioExtensionsDir()
    const profile: CodeServerProfile = {
      key: `datastudio:${hashRepoId(repoId)}`,
      userDataDir,
      extensionsDir,
      pidFilePath: getDataStudioProfilePidFilePath(repoId),
      installRoot: getAdsServerRoot(),
      // Stable port: the workbench's client-side storage (connections + saved
      // DB passwords) is keyed to the http origin.
      allocatePort: () => allocateStablePort(repoId),
      resolveInstalled: resolveAdsServerEntry,
      // Downloads the prebuilt artifact from the project's GitHub release; the
      // from-source script stays the fallback for unsupported platforms.
      ensureInstalled: ensureAdsServerInstalled,
      async prepare() {
        // Older artifacts shipped product.overrides.json without `commit`,
        // breaking every vscode-remote-resource fetch (themes, grammars, …).
        repairAdsProductOverrides()
        await applyDataStudioMachineSettings(repoId)
        // First-run import of desktop ADS settings/keybindings (incl. the
        // user's datasource.connections/connectionGroups). Seeding on the
        // browser side is only-if-absent, so re-staging is always safe.
        stageAdsDesktopImport(repoId)
      },
      buildSpawn: (port) =>
        buildAdsServerSpawn(port, {
          userDataDir,
          extensionsDir,
          importDir: getAdsImportDir(repoId)
        }),
      // The upstream VS Code / ADS server has no /healthz; the workbench root
      // responding 200 is the readiness signal.
      readinessProbePath: '/',
      onPidChanged: (pid) => setDataStudioPid(repoId, pid)
    }
    const manager = new CodeServerManager(profile)
    manager.onStatusChanged((event) => this.emit(repoId, event))
    this.instances.set(repoId, manager)
    return manager
  }

  async acquire(repoId: string, repoPath: string | null): Promise<DataStudioEnsureRunningResult> {
    const manager = this.getOrCreateInstance(repoId, repoPath)
    const { port } = await manager.acquire()
    return { port, partition: getDataStudioPartition(repoId) }
  }

  async retry(repoId: string): Promise<DataStudioEnsureRunningResult> {
    const manager = this.getOrCreateInstance(repoId, null)
    const { port } = await manager.retry()
    return { port, partition: getDataStudioPartition(repoId) }
  }

  release(repoId: string): void {
    this.instances.get(repoId)?.release()
  }

  getStatus(repoId: string): DataStudioStatusEvent {
    const instance = this.instances.get(repoId)
    if (instance) {
      return { ...instance.getStatus(), repoId }
    }
    return {
      repoId,
      status: resolveAdsServerEntry() ? 'stopped' : 'not-installed',
      port: null
    }
  }

  getPartitionForRepo(repoId: string): string {
    return getDataStudioPartition(repoId)
  }

  isDataStudioPartition(partition: string): boolean {
    return this.createdPartitions.has(partition)
  }

  // Kill stale servers from a prior Orca run across ALL repo profiles — a repo
  // not opened this session still gets its orphan reaped. Also drains any
  // profile deletions a previous quit interrupted.
  reapAllDataStudioOrphans(): void {
    const profilesRoot = getDataStudioProfilesRoot()
    if (existsSync(profilesRoot)) {
      for (const entry of this.listDirEntries(profilesRoot)) {
        if (entry === PENDING_DELETE_DIR_NAME) {
          continue
        }
        this.reapPidFile(join(profilesRoot, entry, 'code-server.pid'))
      }
    }
    const pendingRoot = join(profilesRoot, PENDING_DELETE_DIR_NAME)
    if (existsSync(pendingRoot)) {
      for (const entry of this.listDirEntries(pendingRoot)) {
        void removeHostTree(join(pendingRoot, entry)).catch(() => {})
      }
    }
  }

  private listDirEntries(dir: string): string[] {
    try {
      return readdirSync(dir)
    } catch {
      return []
    }
  }

  private reapPidFile(pidFile: string): void {
    if (!existsSync(pidFile)) {
      return
    }
    try {
      const pid = Number(readFileSync(pidFile, 'utf8').trim())
      if (Number.isInteger(pid) && pid > 0) {
        process.kill(pid, 'SIGTERM')
      }
    } catch {
      // process already gone or not ours; ignore
    } finally {
      try {
        rmSync(pidFile, { force: true })
      } catch {
        // best effort
      }
    }
  }

  async shutdownAll(): Promise<void> {
    await Promise.all([...this.instances.values()].map((instance) => instance.shutdown()))
  }

  // Repo removed from Orca: the profile holds hostnames, usernames, and the
  // secret-storage key half — credentials-adjacent material that must not
  // outlive the project. Deletes the server process, profile dir, stable port
  // assignment, and the partition's browser storage (the encrypted passwords).
  async removeProfile(repoId: string): Promise<void> {
    const instance = this.instances.get(repoId)
    if (instance) {
      this.instances.delete(repoId)
      await instance.shutdown()
    }
    await releaseStablePort(repoId).catch(() => {})

    const profileDir = getDataStudioProfileDir(repoId)
    if (existsSync(profileDir)) {
      try {
        const pendingRoot = join(getDataStudioProfilesRoot(), PENDING_DELETE_DIR_NAME)
        mkdirSync(pendingRoot, { recursive: true })
        const tombstone = join(pendingRoot, `${hashRepoId(repoId)}.${Date.now()}`)
        renameSync(profileDir, tombstone)
        void removeHostTree(tombstone).catch(() => {})
      } catch (error) {
        console.warn('[data-studio] Could not delete profile dir:', error)
      }
    }

    const partition = getDataStudioPartition(repoId)
    this.createdPartitions.delete(partition)
    try {
      const sess = session.fromPartition(partition)
      clearBrowserSessionPartitionPolicies(partition, sess)
      await sess.clearStorageData()
      await sess.clearCache()
    } catch {
      // Best effort — the partition is out of the allowlist regardless.
    }
  }
}

let registry: DataStudioRegistry | null = null

export function getDataStudioRegistry(): DataStudioRegistry {
  if (!registry) {
    registry = new DataStudioRegistry()
  }
  return registry
}
