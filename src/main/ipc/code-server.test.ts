import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock, serviceMock, webContentsFromIdMock, registerGuestMock, unregisterGuestMock } =
  vi.hoisted(() => ({
    handleMock: vi.fn(),
    serviceMock: {
      acquire: vi.fn(),
      retry: vi.fn(),
      release: vi.fn(),
      getStatus: vi.fn(() => ({ status: 'stopped', port: null })),
      onStatusChanged: vi.fn(() => () => {})
    },
    webContentsFromIdMock: vi.fn(),
    registerGuestMock: vi.fn(),
    unregisterGuestMock: vi.fn()
  }))

vi.mock('electron', () => ({
  ipcMain: { handle: handleMock },
  BrowserWindow: { getAllWindows: () => [] },
  webContents: { fromId: webContentsFromIdMock }
}))
vi.mock('../code-server/code-server-service', () => ({ getCodeServerService: () => serviceMock }))
vi.mock('../code-server/code-server-guest-shortcut-registry', () => ({
  registerCodeServerGuest: registerGuestMock,
  unregisterCodeServerGuest: unregisterGuestMock
}))
vi.mock('../browser/browser-manager', () => ({
  browserManager: { shouldForwardDictationShortcutToGuests: () => false }
}))

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
    serviceMock.retry.mockReset()
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

  it('re-drives the start on retry without acquiring a ref', async () => {
    serviceMock.retry.mockResolvedValue({ port: 6666 })
    const result = await getHandler('codeServer:retry')({})
    expect(result).toEqual({ port: 6666 })
    expect(serviceMock.acquire).not.toHaveBeenCalled()
  })

  it('returns a structured error when retry throws', async () => {
    serviceMock.retry.mockRejectedValue(new Error('still offline'))
    const result = await getHandler('codeServer:retry')({})
    expect(result).toEqual({ error: 'still offline' })
  })

  it('releases on request', async () => {
    await getHandler('codeServer:release')({})
    expect(serviceMock.release).toHaveBeenCalled()
  })

  describe('codeServer:registerGuest', () => {
    const sender = { id: 42 }
    const makeGuest = (overrides: Record<string, unknown> = {}) => ({
      isDestroyed: () => false,
      getType: () => 'webview',
      hostWebContents: { id: 42 },
      ...overrides
    })

    beforeEach(() => {
      webContentsFromIdMock.mockReset()
      registerGuestMock.mockReset()
      unregisterGuestMock.mockReset()
    })

    it('installs forwarding for a webview guest hosted by the invoking renderer', () => {
      const guest = makeGuest()
      webContentsFromIdMock.mockReturnValue(guest)
      const result = getHandler('codeServer:registerGuest')(
        { sender },
        { codeServerTabId: 'vscode-1', webContentsId: 9 }
      )
      expect(result).toBe(true)
      expect(registerGuestMock).toHaveBeenCalledWith(
        expect.objectContaining({ codeServerTabId: 'vscode-1', guest, rendererWebContentsId: 42 })
      )
    })

    it('rejects malformed args', () => {
      expect(getHandler('codeServer:registerGuest')({ sender }, null)).toBe(false)
      expect(getHandler('codeServer:registerGuest')({ sender }, { codeServerTabId: 5 })).toBe(false)
      expect(registerGuestMock).not.toHaveBeenCalled()
    })

    it('rejects non-webview guests', () => {
      webContentsFromIdMock.mockReturnValue(makeGuest({ getType: () => 'window' }))
      const result = getHandler('codeServer:registerGuest')(
        { sender },
        { codeServerTabId: 'vscode-1', webContentsId: 9 }
      )
      expect(result).toBe(false)
      expect(registerGuestMock).not.toHaveBeenCalled()
    })

    it('rejects guests hosted by a different renderer', () => {
      webContentsFromIdMock.mockReturnValue(makeGuest({ hostWebContents: { id: 999 } }))
      const result = getHandler('codeServer:registerGuest')(
        { sender },
        { codeServerTabId: 'vscode-1', webContentsId: 9 }
      )
      expect(result).toBe(false)
      expect(registerGuestMock).not.toHaveBeenCalled()
    })

    it('unregisters by tab id', () => {
      getHandler('codeServer:unregisterGuest')({ sender }, { codeServerTabId: 'vscode-1' })
      expect(unregisterGuestMock).toHaveBeenCalledWith('vscode-1')
    })
  })
})
