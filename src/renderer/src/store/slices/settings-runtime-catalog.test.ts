import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import {
  MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
  RUNTIME_PROTOCOL_VERSION
} from '../../../../shared/protocol-version'
import { clearRuntimeCompatibilityCacheForTests } from '../../runtime/runtime-rpc-client'
import {
  RUNTIME_CATALOG_STALE_MS,
  resetRuntimeCatalogListingForTests
} from './runtime-status-hydration'
import { createTestStore } from './store-test-helpers'

const runtimeEnvironmentGetStatus = vi.fn()
const settingsGet = vi.fn()
const runtimeEnvironmentList = vi.fn()

function makeRuntimeEnvironment(id: string): PublicKnownRuntimeEnvironment {
  const endpointId = `ws-${id}`
  return {
    id,
    name: id,
    createdAt: 1,
    updatedAt: 1,
    lastUsedAt: null,
    runtimeId: null,
    endpoints: [{ id: endpointId, kind: 'websocket', label: 'WebSocket', endpoint: 'ws://x' }],
    preferredEndpointId: endpointId
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason?: unknown) => void = () => {}
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  clearRuntimeCompatibilityCacheForTests()
  resetRuntimeCatalogListingForTests()
  vi.clearAllMocks()
  runtimeEnvironmentGetStatus.mockResolvedValue({
    id: 'status-rpc-1',
    ok: true,
    result: {
      runtimeId: 'runtime-2',
      graphStatus: 'ready',
      runtimeProtocolVersion: RUNTIME_PROTOCOL_VERSION,
      minCompatibleRuntimeClientVersion: MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION
    },
    _meta: { runtimeId: 'runtime-2' }
  })
  settingsGet.mockResolvedValue({ notifications: {} })
  runtimeEnvironmentList.mockResolvedValue([])
  vi.stubGlobal('window', {
    api: {
      settings: { get: settingsGet },
      runtimeEnvironments: {
        getStatus: runtimeEnvironmentGetStatus,
        list: runtimeEnvironmentList
      }
    }
  })
})

describe('fetchSettings runtime catalog probe', () => {
  it('still probes the runtime catalog when the settings read fails', async () => {
    settingsGet.mockRejectedValueOnce(new Error('unreadable settings.json'))
    const store = createTestStore()

    await store.getState().fetchSettings()
    await vi.waitFor(() => expect(runtimeEnvironmentList).toHaveBeenCalled())

    expect(store.getState().settings).toBeNull()
    expect(store.getState().runtimeEnvironmentCatalogSettled).toBe(true)
  })

  it('probes the runtime catalog after a successful settings read', async () => {
    const store = createTestStore()

    await store.getState().fetchSettings()
    await vi.waitFor(() => expect(runtimeEnvironmentList).toHaveBeenCalled())

    expect(store.getState().settings).not.toBeNull()
    expect(store.getState().runtimeEnvironmentCatalogSettled).toBe(true)
  })

  it('coalesces concurrent settings refreshes into one all-host sweep', async () => {
    const environments = [makeRuntimeEnvironment('env-a'), makeRuntimeEnvironment('env-b')]
    const catalog = deferred<PublicKnownRuntimeEnvironment[]>()
    runtimeEnvironmentList.mockReturnValueOnce(catalog.promise)
    const store = createTestStore()

    await Promise.all(Array.from({ length: 10 }, () => store.getState().fetchSettings()))

    expect(settingsGet).toHaveBeenCalledTimes(10)
    expect(runtimeEnvironmentList).toHaveBeenCalledTimes(1)
    expect(runtimeEnvironmentGetStatus).not.toHaveBeenCalled()

    catalog.resolve(environments)
    await vi.waitFor(() => expect(runtimeEnvironmentGetStatus).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(store.getState().runtimeStatusByEnvironmentId.size).toBe(2))

    await store.getState().fetchSettings()
    expect(settingsGet).toHaveBeenCalledTimes(11)
    expect(runtimeEnvironmentList).toHaveBeenCalledTimes(1)
    expect(runtimeEnvironmentGetStatus).toHaveBeenCalledTimes(2)
  })

  it('fills status coverage after another path publishes only part of the catalog', async () => {
    const environments = [makeRuntimeEnvironment('env-a'), makeRuntimeEnvironment('env-b')]
    runtimeEnvironmentList.mockResolvedValue(environments)
    const store = createTestStore()
    store.getState().setRuntimeEnvironments(environments)
    store.getState().setRuntimeEnvironmentStatus('env-a', { status: null, checkedAt: 1 })

    await store.getState().fetchSettings()
    await vi.waitFor(() => expect(runtimeEnvironmentGetStatus).toHaveBeenCalledTimes(2))

    expect(runtimeEnvironmentList).toHaveBeenCalledTimes(1)
    expect(store.getState().runtimeStatusByEnvironmentId.has('env-b')).toBe(true)
  })

  it('treats an offline result as checked on later settings refreshes', async () => {
    const environments = [makeRuntimeEnvironment('env-a'), makeRuntimeEnvironment('env-b')]
    runtimeEnvironmentList.mockResolvedValue(environments)
    runtimeEnvironmentGetStatus.mockImplementation(({ selector }: { selector: string }) =>
      selector === 'env-b'
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({
            id: 'status-rpc-a',
            ok: true,
            result: {
              runtimeId: 'runtime-a',
              graphStatus: 'ready',
              runtimeProtocolVersion: RUNTIME_PROTOCOL_VERSION,
              minCompatibleRuntimeClientVersion: MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION
            },
            _meta: { runtimeId: 'runtime-a' }
          })
    )
    const store = createTestStore()

    await store.getState().fetchSettings()
    await vi.waitFor(() =>
      expect(store.getState().runtimeStatusByEnvironmentId.get('env-b')?.status).toBeNull()
    )
    await store.getState().fetchSettings()

    expect(settingsGet).toHaveBeenCalledTimes(2)
    expect(runtimeEnvironmentList).toHaveBeenCalledTimes(1)
    expect(runtimeEnvironmentGetStatus).toHaveBeenCalledTimes(2)
  })

  it('retries a failed catalog read on the next settings refresh', async () => {
    const firstCatalog = deferred<PublicKnownRuntimeEnvironment[]>()
    runtimeEnvironmentList
      .mockReturnValueOnce(firstCatalog.promise)
      .mockResolvedValueOnce([makeRuntimeEnvironment('env-a')])
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const store = createTestStore()

    try {
      await store.getState().fetchSettings()
      firstCatalog.reject(new Error('unreadable environments.json'))
      await vi.waitFor(() => expect(store.getState().runtimeEnvironmentCatalogSettled).toBe(true))
      expect(store.getState().runtimeEnvironmentCatalogHydrated).toBe(false)

      await store.getState().fetchSettings()
      await vi.waitFor(() => expect(store.getState().runtimeEnvironmentCatalogHydrated).toBe(true))
      await vi.waitFor(() => expect(runtimeEnvironmentGetStatus).toHaveBeenCalledTimes(1))
      await store.getState().fetchSettings()

      expect(settingsGet).toHaveBeenCalledTimes(3)
      expect(runtimeEnvironmentList).toHaveBeenCalledTimes(2)
      expect(runtimeEnvironmentGetStatus).toHaveBeenCalledTimes(1)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('uses an authoritative sweep to remove ghost status entries', async () => {
    const store = createTestStore()
    store.getState().setRuntimeEnvironments([])
    store.getState().setRuntimeEnvironmentStatus('removed-env', { status: null, checkedAt: 1 })

    await store.getState().fetchSettings()
    await vi.waitFor(() => expect(store.getState().runtimeStatusByEnvironmentId.size).toBe(0))

    expect(runtimeEnvironmentList).toHaveBeenCalledTimes(1)
  })

  it('picks up an externally added host once the listing goes stale', async () => {
    runtimeEnvironmentList.mockResolvedValue([makeRuntimeEnvironment('env-a')])
    const store = createTestStore()
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)

    try {
      await store.getState().fetchSettings()
      await vi.waitFor(() => expect(store.getState().runtimeStatusByEnvironmentId.size).toBe(1))

      // Another client adds a host; coverage still matches, so only staleness can reveal it.
      runtimeEnvironmentList.mockResolvedValue([
        makeRuntimeEnvironment('env-a'),
        makeRuntimeEnvironment('env-b')
      ])
      await store.getState().fetchSettings()
      expect(runtimeEnvironmentList).toHaveBeenCalledTimes(1)
      expect(store.getState().runtimeEnvironments.map(({ id }) => id)).toEqual(['env-a'])

      now.mockReturnValue(1_000_000 + RUNTIME_CATALOG_STALE_MS + 1)
      await store.getState().fetchSettings()
      await vi.waitFor(() =>
        expect(store.getState().runtimeEnvironments.map(({ id }) => id)).toEqual(['env-a', 'env-b'])
      )
      await vi.waitFor(() =>
        expect(store.getState().runtimeStatusByEnvironmentId.has('env-b')).toBe(true)
      )
      expect(runtimeEnvironmentList).toHaveBeenCalledTimes(2)
    } finally {
      now.mockRestore()
    }
  })
})
