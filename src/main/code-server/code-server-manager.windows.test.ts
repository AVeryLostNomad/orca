import { describe, expect, it, vi, beforeEach } from 'vitest'
import type * as NodeFs from 'node:fs'
import type * as CodeServerPaths from './code-server-paths'

const { resolveLaunchMock, spawnMock, netRequestMock, createServerMock } = vi.hoisted(() => ({
  resolveLaunchMock: vi.fn(),
  spawnMock: vi.fn(),
  netRequestMock: vi.fn(),
  createServerMock: vi.fn()
}))

const WIN_LAUNCH = {
  command: '/userData/code-server/lib/code-server-4.127.0/lib/node.exe',
  args: ['/userData/code-server/lib/code-server-4.127.0/out/node/entry.js'],
  root: '/userData/code-server/lib/code-server-4.127.0'
}

vi.mock('electron', () => ({
  app: { getPath: () => '/userData' },
  net: { request: netRequestMock }
}))
vi.mock('./code-server-installer', () => ({ ensureCodeServerInstalled: vi.fn() }))
vi.mock('./code-server-editor-user-config', () => ({ mirrorEditorUserConfig: vi.fn() }))
vi.mock('../startup/hydrate-shell-path', () => ({
  hydrateShellPath: vi.fn(() =>
    Promise.resolve({ ok: false, segments: [], failureReason: 'no_shell' as const })
  ),
  mergePathSegments: vi.fn(() => [])
}))
vi.mock('node:child_process', () => ({ spawn: spawnMock, execFile: vi.fn() }))
vi.mock('node:net', () => ({ createServer: createServerMock }))
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof NodeFs>()
  return { ...original }
})
vi.mock('./code-server-paths', async (importOriginal) => {
  const original = await importOriginal<typeof CodeServerPaths>()
  return { ...original, resolveCodeServerLaunch: resolveLaunchMock }
})

import { CodeServerManager } from './code-server-manager'
import { ensureCodeServerInstalled } from './code-server-installer'
import { mirrorEditorUserConfig } from './code-server-editor-user-config'

function primeSuccessfulStart(port: number, kill = vi.fn()): void {
  createServerMock.mockImplementation(() => ({
    once: () => {},
    listen: (_port: number, _host: string, cb: () => void) => cb(),
    address: () => ({ port }),
    close: (cb: () => void) => cb()
  }))
  netRequestMock.mockImplementation(() => {
    const handlers: Record<string, (arg?: unknown) => void> = {}
    return {
      on: (event: string, cb: (arg?: unknown) => void) => {
        handlers[event] = cb
      },
      end: () => {
        handlers.response?.({
          statusCode: 200,
          on: (event: string, cb: () => void) => {
            if (event === 'end') {
              cb()
            }
          }
        })
      }
    }
  })
  spawnMock.mockImplementation(() => ({
    pid: 4242,
    killed: false,
    stderr: { on: vi.fn() },
    on: vi.fn(),
    removeAllListeners: vi.fn(),
    kill
  }))
}

describe('CodeServerManager on win32', () => {
  beforeEach(async () => {
    resolveLaunchMock.mockReset()
    spawnMock.mockReset()
    createServerMock.mockReset()
    netRequestMock.mockReset()
    vi.mocked(ensureCodeServerInstalled).mockReset()
    vi.mocked(mirrorEditorUserConfig).mockReset()
    vi.mocked(mirrorEditorUserConfig).mockResolvedValue(undefined)
    const fs = await import('node:fs')
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
    vi.spyOn(fs, 'rmSync').mockImplementation(() => {})
  })

  it('spawns the bundled node.exe against entry.js with the server args appended', async () => {
    resolveLaunchMock.mockReturnValue(WIN_LAUNCH)
    vi.mocked(ensureCodeServerInstalled).mockResolvedValue(WIN_LAUNCH)
    primeSuccessfulStart(5001)

    const manager = new CodeServerManager({ platform: 'win32' })
    await manager.acquire()

    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [command, args, options] = spawnMock.mock.calls[0] as [
      string,
      string[],
      { windowsHide: boolean }
    ]
    expect(command).toBe(WIN_LAUNCH.command)
    expect(args[0]).toBe(WIN_LAUNCH.args[0])
    expect(args).toContain('--bind-addr')
    expect(args).toContain('--session-socket')
    expect(options.windowsHide).toBe(true)
  })

  it('kills the whole child tree via the injected tree killer on release', async () => {
    resolveLaunchMock.mockReturnValue(WIN_LAUNCH)
    vi.mocked(ensureCodeServerInstalled).mockResolvedValue(WIN_LAUNCH)
    const childKill = vi.fn()
    primeSuccessfulStart(5002, childKill)
    const killWindowsTree = vi.fn(() => Promise.resolve())

    const manager = new CodeServerManager({ platform: 'win32', killWindowsTree })
    await manager.acquire()
    manager.release()
    await vi.waitFor(() => expect(killWindowsTree).toHaveBeenCalledWith(4242))
    // The direct handle is still closed after taskkill, best-effort.
    await vi.waitFor(() => expect(childKill).toHaveBeenCalled())
    expect(childKill).not.toHaveBeenCalledWith('SIGTERM')
  })

  it('reaps a pidfile orphan only when the process provably runs our install', async () => {
    const fs = await import('node:fs')
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue('7777')
    const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {})
    const killWindowsTree = vi.fn(() => Promise.resolve())
    const ownRow = {
      pid: 7777,
      ppid: 1,
      name: 'node.exe',
      command: 'node.exe /userData/code-server/lib/code-server-4.127.0/out/node/entry.js',
      executablePath: ''
    }

    const owned = new CodeServerManager({
      platform: 'win32',
      killWindowsTree,
      readProcessRows: () => Promise.resolve([ownRow])
    })
    await owned.reapOrphan()
    expect(killWindowsTree).toHaveBeenCalledWith(7777)
    expect(rmSpy).toHaveBeenCalled()

    killWindowsTree.mockClear()
    const recycled = new CodeServerManager({
      platform: 'win32',
      killWindowsTree,
      readProcessRows: () =>
        Promise.resolve([{ ...ownRow, command: 'notepad.exe', executablePath: 'C:\\notepad.exe' }])
    })
    await recycled.reapOrphan()
    expect(killWindowsTree).not.toHaveBeenCalled()

    const unqueryable = new CodeServerManager({
      platform: 'win32',
      killWindowsTree,
      readProcessRows: () => Promise.reject(new Error('scan unavailable'))
    })
    await unqueryable.reapOrphan()
    expect(killWindowsTree).not.toHaveBeenCalled()
  })
})
