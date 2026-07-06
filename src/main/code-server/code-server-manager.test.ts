import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as NodeFs from 'node:fs'
import type * as CodeServerPaths from './code-server-paths'

const { resolveExeMock, spawnMock, netRequestMock, createServerMock } = vi.hoisted(() => ({
  resolveExeMock: vi.fn(),
  spawnMock: vi.fn(),
  netRequestMock: vi.fn(),
  createServerMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/userData' },
  net: { request: netRequestMock }
}))
vi.mock('./code-server-installer', () => ({ ensureCodeServerInstalled: vi.fn() }))
vi.mock('./code-server-vscode-settings-link', () => ({ linkVsCodeUserSettings: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: spawnMock }))
vi.mock('node:net', () => ({ createServer: createServerMock }))
// Passthrough spread (not a full replacement) so vi.spyOn can patch individual
// fs functions below — a real ES module namespace object isn't spy-able.
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof NodeFs>()
  return { ...original }
})
// Passthrough spread, overriding only resolveCodeServerExecutable so the
// not-installed/single-flight tests can control it while buildCodeServerArgs
// keeps using the real path-joining logic (anchored at the mocked userData dir).
vi.mock('./code-server-paths', async (importOriginal) => {
  const original = await importOriginal<typeof CodeServerPaths>()
  return { ...original, resolveCodeServerExecutable: resolveExeMock }
})

import { buildCodeServerArgs, CodeServerManager } from './code-server-manager'
import { ensureCodeServerInstalled } from './code-server-installer'
import { linkVsCodeUserSettings } from './code-server-vscode-settings-link'

describe('buildCodeServerArgs', () => {
  it('binds loopback, disables auth+telemetry, isolates dirs', () => {
    expect(buildCodeServerArgs(12345)).toEqual([
      '--bind-addr',
      '127.0.0.1:12345',
      '--auth',
      'none',
      '--disable-telemetry',
      '--user-data-dir',
      '/userData/code-server/user-data',
      '--extensions-dir',
      '/userData/code-server/extensions'
    ])
  })
})

describe('reapOrphan', () => {
  it('sends SIGTERM to a stale pid and removes the pidfile', async () => {
    const fs = await import('node:fs')
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue('4242')
    const rmSpy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {})
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    new CodeServerManager().reapOrphan()
    expect(killSpy).toHaveBeenCalledWith(4242, 'SIGTERM')
    expect(rmSpy).toHaveBeenCalled()
    killSpy.mockRestore()
  })
})

describe('initial status', () => {
  afterEach(() => {
    resolveExeMock.mockReset()
  })

  it('is not-installed when the executable does not resolve', () => {
    resolveExeMock.mockReturnValue(null)
    expect(new CodeServerManager().getStatus().status).toBe('not-installed')
  })

  it('is stopped when the executable already resolves', () => {
    resolveExeMock.mockReturnValue('/opt/code-server/bin/code-server')
    expect(new CodeServerManager().getStatus().status).toBe('stopped')
  })
})

// Fakes the full startProcess() dependency chain (net.createServer for the
// free-port pick, electron net.request for the /healthz probe, and spawn for
// the child) so acquire()'s single-flight guard can be exercised end to end.
function primeSuccessfulStart(port: number): void {
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
    kill: vi.fn()
  }))
}

describe('acquire single-flight', () => {
  afterEach(() => {
    resolveExeMock.mockReset()
    spawnMock.mockReset()
    createServerMock.mockReset()
    netRequestMock.mockReset()
    vi.mocked(ensureCodeServerInstalled).mockReset()
    vi.mocked(linkVsCodeUserSettings).mockReset()
  })

  it('spawns exactly one child when two acquire() calls overlap before ready', async () => {
    resolveExeMock.mockReturnValue('/opt/code-server/bin/code-server')
    vi.mocked(ensureCodeServerInstalled).mockResolvedValue('/opt/code-server/bin/code-server')
    vi.mocked(linkVsCodeUserSettings).mockResolvedValue(undefined)
    primeSuccessfulStart(4999)

    const fs = await import('node:fs')
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})

    const manager = new CodeServerManager()
    // Both calls fire before either awaits — this is the overlap the fix guards against.
    const [first, second] = await Promise.all([manager.acquire(), manager.acquire()])

    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(first).toEqual({ port: 4999 })
    expect(second).toEqual({ port: 4999 })
  })
})
