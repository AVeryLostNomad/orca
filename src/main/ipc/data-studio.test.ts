import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock, registryMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  registryMock: {
    acquire: vi.fn(),
    retry: vi.fn(),
    release: vi.fn(),
    getStatus: vi.fn(() => ({ repoId: 'r', status: 'stopped', port: null })),
    onStatusChanged: vi.fn(() => () => {}),
    reapAllDataStudioOrphans: vi.fn()
  }
}))

vi.mock('electron', () => ({
  ipcMain: { handle: handleMock },
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('../data-studio/data-studio-registry', () => ({
  getDataStudioRegistry: () => registryMock
}))

import { registerDataStudioHandlers } from './data-studio'

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = handleMock.mock.calls.find((entry) => entry[0] === channel)
  if (!call) {
    throw new Error(`${channel} not registered`)
  }
  return call[1] as (...args: unknown[]) => unknown
}

describe('registerDataStudioHandlers', () => {
  beforeEach(() => {
    handleMock.mockReset()
    registryMock.acquire.mockReset()
    registryMock.retry.mockReset()
    registryMock.release.mockReset()
    registryMock.reapAllDataStudioOrphans.mockReset()
    registerDataStudioHandlers()
  })

  it('reaps orphaned servers across all repo profiles at registration', () => {
    expect(registryMock.reapAllDataStudioOrphans).toHaveBeenCalledTimes(1)
  })

  it('returns port and partition on ensureRunning', async () => {
    registryMock.acquire.mockResolvedValue({ port: 41100, partition: 'persist:orca-datastudio-x' })
    const result = await getHandler('dataStudio:ensureRunning')(
      {},
      { repoId: 'repo-1', repoPath: '/x' }
    )
    expect(result).toEqual({ port: 41100, partition: 'persist:orca-datastudio-x' })
    expect(registryMock.acquire).toHaveBeenCalledWith('repo-1', '/x')
  })

  it('rejects a missing repoId without touching the registry', async () => {
    expect(await getHandler('dataStudio:ensureRunning')({}, {})).toEqual({
      error: 'Invalid repoId'
    })
    expect(await getHandler('dataStudio:ensureRunning')({}, null)).toEqual({
      error: 'Invalid repoId'
    })
    expect(registryMock.acquire).not.toHaveBeenCalled()
  })

  it('returns a structured error when acquire throws', async () => {
    registryMock.acquire.mockRejectedValue(new Error('offline'))
    const result = await getHandler('dataStudio:ensureRunning')({}, { repoId: 'repo-1' })
    expect(result).toEqual({ error: 'offline' })
  })

  it('re-drives the start on retry without acquiring a ref', async () => {
    registryMock.retry.mockResolvedValue({ port: 41101, partition: 'persist:orca-datastudio-x' })
    const result = await getHandler('dataStudio:retry')({}, { repoId: 'repo-1' })
    expect(result).toEqual({ port: 41101, partition: 'persist:orca-datastudio-x' })
    expect(registryMock.acquire).not.toHaveBeenCalled()
  })

  it('releases by repoId', async () => {
    await getHandler('dataStudio:release')({}, { repoId: 'repo-1' })
    expect(registryMock.release).toHaveBeenCalledWith('repo-1')
  })

  it('returns per-repo status', async () => {
    const result = await getHandler('dataStudio:getStatus')({}, { repoId: 'repo-1' })
    expect(result).toEqual({ repoId: 'r', status: 'stopped', port: null })
    expect(registryMock.getStatus).toHaveBeenCalledWith('repo-1')
  })
})
