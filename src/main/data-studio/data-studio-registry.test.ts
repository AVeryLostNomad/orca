import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CodeServerStatusEvent } from '../../shared/code-server-types'
import type { CodeServerProfile } from '../code-server/code-server-profile'
import type * as AdsServerModule from './ads-server'
import type * as AdsDesktopImportModule from './ads-desktop-import'

const {
  userDataHolder,
  fakeManagers,
  registerCheckerMock,
  installPoliciesMock,
  clearPoliciesMock,
  sessionFromPartitionMock,
  clearStorageDataMock,
  clearCacheMock,
  allocatePortMock,
  releasePortMock,
  machineSettingsMock,
  removeHostTreeMock,
  resolveAdsEntryMock,
  buildAdsSpawnMock,
  ensureAdsInstalledMock,
  stageImportMock
} = vi.hoisted(() => ({
  userDataHolder: { path: '' },
  fakeManagers: [] as {
    profile: CodeServerProfile
    emit: (e: CodeServerStatusEvent) => void
    shutdown: () => Promise<void>
    shutdownCalled: boolean
    released: number
  }[],
  registerCheckerMock: vi.fn(),
  installPoliciesMock: vi.fn(),
  clearPoliciesMock: vi.fn(),
  sessionFromPartitionMock: vi.fn(),
  clearStorageDataMock: vi.fn(() => Promise.resolve()),
  clearCacheMock: vi.fn(() => Promise.resolve()),
  allocatePortMock: vi.fn(() => Promise.resolve(45001)),
  releasePortMock: vi.fn(() => Promise.resolve()),
  machineSettingsMock: vi.fn(() => Promise.resolve()),
  removeHostTreeMock: vi.fn(() => Promise.resolve()),
  resolveAdsEntryMock: vi.fn(() => '/ads/out/server-main.js'),
  buildAdsSpawnMock: vi.fn(() => ({ command: '/ads/node', args: ['server-main.js'], env: {} })),
  ensureAdsInstalledMock: vi.fn(() => Promise.resolve()),
  stageImportMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => userDataHolder.path },
  session: { fromPartition: sessionFromPartitionMock }
}))

vi.mock('../code-server/code-server-manager', () => {
  class FakeCodeServerManager {
    readonly profile: CodeServerProfile
    private readonly listeners = new Set<(e: CodeServerStatusEvent) => void>()
    shutdownCalled = false
    released = 0
    constructor(profile: CodeServerProfile) {
      this.profile = profile
      fakeManagers.push(this as never)
    }
    onStatusChanged(cb: (e: CodeServerStatusEvent) => void): () => void {
      this.listeners.add(cb)
      return () => this.listeners.delete(cb)
    }
    emit(event: CodeServerStatusEvent): void {
      for (const listener of this.listeners) {
        listener(event)
      }
    }
    async acquire(): Promise<{ port: number }> {
      return { port: await this.profile.allocatePort() }
    }
    async retry(): Promise<{ port: number }> {
      return { port: await this.profile.allocatePort() }
    }
    release(): void {
      this.released += 1
    }
    getStatus(): CodeServerStatusEvent {
      return { status: 'ready', port: 45001 }
    }
    async shutdown(): Promise<void> {
      this.shutdownCalled = true
    }
  }
  return { CodeServerManager: FakeCodeServerManager }
})

vi.mock('../browser/browser-session-registry', () => ({
  browserSessionRegistry: { registerExtraAllowedPartitionChecker: registerCheckerMock }
}))
vi.mock('../browser/browser-session-partition-policies', () => ({
  installBrowserSessionPartitionPolicies: installPoliciesMock,
  clearBrowserSessionPartitionPolicies: clearPoliciesMock
}))
vi.mock('./data-studio-ports', () => ({
  allocateStablePort: allocatePortMock,
  releaseStablePort: releasePortMock
}))
vi.mock('./data-studio-machine-settings', () => ({
  applyDataStudioMachineSettings: machineSettingsMock
}))
vi.mock('./ads-server-installer', () => ({
  ensureAdsServerInstalled: ensureAdsInstalledMock
}))
vi.mock('./ads-desktop-import', async (importOriginal) => {
  const original = await importOriginal<typeof AdsDesktopImportModule>()
  return { ...original, stageAdsDesktopImport: stageImportMock }
})
vi.mock('./ads-server', async (importOriginal) => {
  const original = await importOriginal<typeof AdsServerModule>()
  return {
    ...original,
    resolveAdsServerEntry: resolveAdsEntryMock,
    buildAdsServerSpawn: buildAdsSpawnMock
  }
})
vi.mock('../host-tree-removal', () => ({ removeHostTree: removeHostTreeMock }))

import { getDataStudioPartition, getDataStudioProfileDir, hashRepoId } from './data-studio-paths'

async function loadRegistry() {
  vi.resetModules()
  const { getDataStudioRegistry } = await import('./data-studio-registry')
  return getDataStudioRegistry()
}

const REPO_A = 'repo-a::/x/a'
const REPO_B = 'repo-b::/x/b'

describe('data-studio-registry', () => {
  beforeEach(() => {
    userDataHolder.path = mkdtempSync(join(tmpdir(), 'orca-ds-registry-'))
    fakeManagers.length = 0
    for (const mock of [
      registerCheckerMock,
      installPoliciesMock,
      clearPoliciesMock,
      sessionFromPartitionMock,
      removeHostTreeMock
    ]) {
      mock.mockClear()
    }
    sessionFromPartitionMock.mockReturnValue({
      clearStorageData: clearStorageDataMock,
      clearCache: clearCacheMock
    })
  })

  afterEach(() => {
    rmSync(userDataHolder.path, { recursive: true, force: true })
  })

  it('reuses one instance per repo and creates separate instances per repo', async () => {
    const registry = await loadRegistry()
    const first = await registry.acquire(REPO_A, '/x/a')
    const again = await registry.acquire(REPO_A, '/x/a')
    expect(fakeManagers).toHaveLength(1)
    expect(first).toEqual({ port: 45001, partition: getDataStudioPartition(REPO_A) })
    expect(again.partition).toBe(first.partition)

    await registry.acquire(REPO_B, '/x/b')
    expect(fakeManagers).toHaveLength(2)
    expect(fakeManagers[0].profile.key).toBe(`datastudio:${hashRepoId(REPO_A)}`)
    expect(fakeManagers[1].profile.key).toBe(`datastudio:${hashRepoId(REPO_B)}`)
  })

  it('re-emits manager status events tagged with the repoId', async () => {
    const registry = await loadRegistry()
    const events: { repoId: string; status: string }[] = []
    registry.onStatusChanged((event) => events.push(event))
    await registry.acquire(REPO_A, null)
    fakeManagers[0].emit({ status: 'ready', port: 45001 })
    expect(events).toEqual([{ status: 'ready', port: 45001, repoId: REPO_A }])
  })

  it('allowlists partitions fail-closed: only after the instance was created', async () => {
    const registry = await loadRegistry()
    const partition = getDataStudioPartition(REPO_A)
    expect(registry.isDataStudioPartition(partition)).toBe(false)
    await registry.acquire(REPO_A, null)
    expect(registry.isDataStudioPartition(partition)).toBe(true)
    // A plausible-looking but never-created partition stays rejected.
    expect(registry.isDataStudioPartition('persist:orca-datastudio-0000000000000000')).toBe(false)
    // The same checker is registered with the browser-session allowlist.
    expect(registerCheckerMock).toHaveBeenCalledTimes(1)
    const checker = registerCheckerMock.mock.calls[0][0] as (p: string) => boolean
    expect(checker(partition)).toBe(true)
    expect(installPoliciesMock).toHaveBeenCalledWith(
      expect.objectContaining({ partition, scope: 'isolated' })
    )
  })

  it('shutdownAll shuts down every instance', async () => {
    const registry = await loadRegistry()
    await registry.acquire(REPO_A, null)
    await registry.acquire(REPO_B, null)
    await registry.shutdownAll()
    expect(fakeManagers.every((manager) => manager.shutdownCalled)).toBe(true)
  })

  it('removeProfile shuts the server, drops the port, tombstones the dir, and purges the partition', async () => {
    const registry = await loadRegistry()
    await registry.acquire(REPO_A, '/x/a')
    const profileDir = getDataStudioProfileDir(REPO_A)
    expect(existsSync(profileDir)).toBe(true)

    await registry.removeProfile(REPO_A)

    expect(fakeManagers[0].shutdownCalled).toBe(true)
    expect(releasePortMock).toHaveBeenCalledWith(REPO_A)
    expect(existsSync(profileDir)).toBe(false)
    expect(removeHostTreeMock).toHaveBeenCalled()
    const partition = getDataStudioPartition(REPO_A)
    expect(sessionFromPartitionMock).toHaveBeenCalledWith(partition)
    expect(clearStorageDataMock).toHaveBeenCalled()
    expect(registry.isDataStudioPartition(partition)).toBe(false)
  })

  it('reapAllDataStudioOrphans SIGTERMs every profile pidfile and drains pending deletes', async () => {
    const registry = await loadRegistry()
    const profilesRoot = join(userDataHolder.path, 'data-studio', 'profiles')
    mkdirSync(join(profilesRoot, 'aaaa'), { recursive: true })
    writeFileSync(join(profilesRoot, 'aaaa', 'code-server.pid'), '4242')
    mkdirSync(join(profilesRoot, '.pending-delete'), { recursive: true })
    mkdirSync(join(profilesRoot, '.pending-delete', 'bbbb.123'), { recursive: true })

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    registry.reapAllDataStudioOrphans()
    expect(killSpy).toHaveBeenCalledWith(4242, 'SIGTERM')
    expect(existsSync(join(profilesRoot, 'aaaa', 'code-server.pid'))).toBe(false)
    expect(removeHostTreeMock).toHaveBeenCalledWith(
      join(profilesRoot, '.pending-delete', 'bbbb.123')
    )
    killSpy.mockRestore()
  })

  it('builds an ADS-server profile: prepare applies machine settings, spawn/readiness come from ads-server', async () => {
    const registry = await loadRegistry()
    machineSettingsMock.mockClear()
    buildAdsSpawnMock.mockClear()
    await registry.acquire(REPO_A, null)
    const profile = fakeManagers[0].profile
    await profile.prepare()
    expect(machineSettingsMock).toHaveBeenCalledWith(REPO_A)
    const spawn = profile.buildSpawn(45001)
    expect(buildAdsSpawnMock).toHaveBeenCalledWith(45001, {
      userDataDir: profile.userDataDir,
      extensionsDir: profile.extensionsDir,
      importDir: join(getDataStudioProfileDir(REPO_A), 'ads-import')
    })
    expect(spawn.command).toBe('/ads/node')
    // The upstream VS Code / ADS server has no /healthz endpoint.
    expect(profile.readinessProbePath).toBe('/')
  })

  it('ensureInstalled delegates to the release-artifact installer', async () => {
    const registry = await loadRegistry()
    await registry.acquire(REPO_A, null)
    ensureAdsInstalledMock.mockClear()
    const onProgress = (): void => {}
    await fakeManagers[0].profile.ensureInstalled(onProgress)
    expect(ensureAdsInstalledMock).toHaveBeenCalledWith(onProgress)
  })

  it('prepare stages the desktop-ADS config import for first-run seeding', async () => {
    const registry = await loadRegistry()
    await registry.acquire(REPO_A, null)
    stageImportMock.mockClear()
    await fakeManagers[0].profile.prepare()
    expect(stageImportMock).toHaveBeenCalledWith(REPO_A)
  })
})
