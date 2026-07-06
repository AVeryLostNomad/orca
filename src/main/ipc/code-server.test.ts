import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock, serviceMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  serviceMock: {
    acquire: vi.fn(),
    release: vi.fn(),
    getStatus: vi.fn(() => ({ status: 'stopped', port: null })),
    onStatusChanged: vi.fn(() => () => {})
  }
}))

vi.mock('electron', () => ({
  ipcMain: { handle: handleMock },
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('../code-server/code-server-service', () => ({ getCodeServerService: () => serviceMock }))

import { registerCodeServerHandlers } from './code-server'

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = handleMock.mock.calls.find((entry) => entry[0] === channel)
  if (!call) {
    throw new Error(`${channel} not registered`)
  }
  return call[1] as (...args: unknown[]) => unknown
}

describe('registerCodeServerHandlers', () => {
  beforeEach(() => {
    handleMock.mockReset()
    serviceMock.acquire.mockReset()
    registerCodeServerHandlers()
  })

  it('returns the port on ensureRunning', async () => {
    serviceMock.acquire.mockResolvedValue({ port: 5555 })
    const result = await getHandler('codeServer:ensureRunning')({})
    expect(result).toEqual({ port: 5555 })
  })

  it('returns a structured error when acquire throws', async () => {
    serviceMock.acquire.mockRejectedValue(new Error('offline'))
    const result = await getHandler('codeServer:ensureRunning')({})
    expect(result).toEqual({ error: 'offline' })
  })

  it('releases on request', async () => {
    await getHandler('codeServer:release')({})
    expect(serviceMock.release).toHaveBeenCalled()
  })
})
