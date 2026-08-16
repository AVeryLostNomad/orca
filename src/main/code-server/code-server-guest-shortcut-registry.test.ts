import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { webContentsFromIdMock } = vi.hoisted(() => ({
  webContentsFromIdMock: vi.fn()
}))

vi.mock('electron', () => ({
  webContents: { fromId: webContentsFromIdMock },
  screen: { getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })) }
}))

import {
  disposeAllCodeServerGuests,
  registerCodeServerGuest,
  unregisterCodeServerGuest
} from './code-server-guest-shortcut-registry'

type GuestHandler = (...args: unknown[]) => void

function makeGuest(id = 100) {
  const listeners = new Map<string, GuestHandler[]>()
  const add = (event: string, handler: GuestHandler): void => {
    listeners.set(event, [...(listeners.get(event) ?? []), handler])
  }
  const guest = {
    id,
    on: vi.fn(add),
    once: vi.fn(add),
    off: vi.fn((event: string, handler: GuestHandler) => {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((h) => h !== handler)
      )
    }),
    isDestroyed: vi.fn(() => false),
    getZoomLevel: vi.fn(() => 0),
    setZoomLevel: vi.fn()
  }
  return {
    guest: guest as unknown as Electron.WebContents,
    mocks: guest,
    emit: (event: string, ...args: unknown[]): void => {
      for (const handler of listeners.get(event) ?? []) {
        handler(...args)
      }
    },
    listenerCount: (event: string): number => (listeners.get(event) ?? []).length
  }
}

function triggerKeyDown(
  emit: (event: string, ...args: unknown[]) => void,
  input: Partial<Electron.Input>
): ReturnType<typeof vi.fn> {
  const preventDefault = vi.fn()
  emit(
    'before-input-event',
    { preventDefault },
    { type: 'keyDown', alt: false, meta: false, control: false, shift: false, ...input }
  )
  return preventDefault
}

describe('registerCodeServerGuest', () => {
  let rendererSendMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    rendererSendMock = vi.fn()
    webContentsFromIdMock.mockReset()
    webContentsFromIdMock.mockReturnValue({
      send: rendererSendMock,
      isDestroyed: () => false
    })
  })

  afterEach(() => {
    disposeAllCodeServerGuests()
  })

  it('forwards allowInVsCode chords to the host renderer with preventDefault', () => {
    const { guest, emit } = makeGuest()
    registerCodeServerGuest({ codeServerTabId: 'vscode-1', guest, rendererWebContentsId: 7 })

    const isMac = process.platform === 'darwin'
    const preventDefault = triggerKeyDown(emit, {
      key: 'j',
      code: 'KeyJ',
      meta: isMac,
      control: !isMac,
      // Why: the default worktree.palette chord is Cmd+J on mac, Ctrl+Shift+J elsewhere.
      shift: !isMac
    })

    expect(rendererSendMock).toHaveBeenCalledWith('ui:toggleWorktreePalette')
    expect(preventDefault).toHaveBeenCalled()
  })

  it('leaves unmarked chords (Cmd/Ctrl+P quick open) with VS Code', () => {
    const { guest, emit } = makeGuest()
    registerCodeServerGuest({ codeServerTabId: 'vscode-1', guest, rendererWebContentsId: 7 })

    const isMac = process.platform === 'darwin'
    const preventDefault = triggerKeyDown(emit, {
      key: 'p',
      code: 'KeyP',
      meta: isMac,
      control: !isMac
    })

    expect(rendererSendMock).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('applies zoom on the guest itself instead of renderer browser-zoom state', () => {
    const { guest, mocks, emit } = makeGuest()
    registerCodeServerGuest({ codeServerTabId: 'vscode-1', guest, rendererWebContentsId: 7 })

    const isMac = process.platform === 'darwin'
    triggerKeyDown(emit, { key: '=', code: 'Equal', meta: isMac, control: !isMac })
    expect(mocks.setZoomLevel).toHaveBeenCalledWith(0.5)

    triggerKeyDown(emit, { key: '0', code: 'Digit0', meta: isMac, control: !isMac })
    expect(mocks.setZoomLevel).toHaveBeenCalledWith(0)
    expect(rendererSendMock).not.toHaveBeenCalledWith('ui:zoomBrowserPage', expect.anything())
  })

  it('re-registration replaces the previous guest listeners', () => {
    const first = makeGuest(100)
    const second = makeGuest(101)
    registerCodeServerGuest({
      codeServerTabId: 'vscode-1',
      guest: first.guest,
      rendererWebContentsId: 7
    })
    registerCodeServerGuest({
      codeServerTabId: 'vscode-1',
      guest: second.guest,
      rendererWebContentsId: 7
    })

    expect(first.listenerCount('before-input-event')).toBe(0)
    expect(second.listenerCount('before-input-event')).toBe(1)
  })

  it('auto-unregisters on guest destroy', () => {
    const { guest, emit, listenerCount } = makeGuest()
    registerCodeServerGuest({ codeServerTabId: 'vscode-1', guest, rendererWebContentsId: 7 })

    emit('destroyed')

    expect(listenerCount('before-input-event')).toBe(0)
    // A later unregister for the same tab is a no-op, not a double-cleanup.
    expect(() => unregisterCodeServerGuest('vscode-1')).not.toThrow()
  })

  it('drops forwarding silently when the host renderer is gone', () => {
    webContentsFromIdMock.mockReturnValue(undefined)
    const { guest, emit } = makeGuest()
    registerCodeServerGuest({ codeServerTabId: 'vscode-1', guest, rendererWebContentsId: 7 })

    const isMac = process.platform === 'darwin'
    expect(() =>
      triggerKeyDown(emit, {
        key: 'j',
        code: 'KeyJ',
        meta: isMac,
        control: !isMac,
        shift: !isMac
      })
    ).not.toThrow()
    expect(rendererSendMock).not.toHaveBeenCalled()
  })
})
