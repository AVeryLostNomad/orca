import { beforeEach, describe, expect, it, vi } from 'vitest'

const { spawnMock, resolveExeMock, resolveScriptMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  resolveExeMock: vi.fn(),
  resolveScriptMock: vi.fn()
}))

vi.mock('node:child_process', () => ({ spawn: spawnMock }))
vi.mock('./code-server-paths', () => ({
  CODE_SERVER_VERSION: '4.99.4',
  getCodeServerCacheRoot: () => '/userData/code-server',
  resolveCodeServerExecutable: resolveExeMock,
  resolveCodeServerInstallScript: resolveScriptMock
}))

import { ensureCodeServerInstalled, CodeServerInstallError } from './code-server-installer'

describe('ensureCodeServerInstalled', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    resolveExeMock.mockReset()
    resolveScriptMock.mockReset()
  })

  it('is idempotent: skips install when the executable already resolves', async () => {
    resolveExeMock.mockReturnValue('/userData/code-server/bin/code-server')
    const exe = await ensureCodeServerInstalled()
    expect(exe).toBe('/userData/code-server/bin/code-server')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('throws no-install-script when the vendored script is missing', async () => {
    resolveExeMock.mockReturnValue(null)
    resolveScriptMock.mockReturnValue(null)
    await expect(ensureCodeServerInstalled()).rejects.toMatchObject({
      code: 'no-install-script'
    })
    expect(CodeServerInstallError).toBeDefined()
  })

  it('spawns sh install.sh with standalone/prefix/version flags', async () => {
    // First resolve null (not installed), then the path after install.
    resolveExeMock
      .mockReturnValueOnce(null)
      .mockReturnValue('/userData/code-server/bin/code-server')
    resolveScriptMock.mockReturnValue('/res/code-server/install.sh')
    spawnMock.mockImplementation(() => {
      const listeners: Record<string, (arg: number) => void> = {}
      return {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: (event: string, cb: (arg: number) => void) => {
          listeners[event] = cb
          if (event === 'close') {
            setTimeout(() => cb(0), 0)
          }
        }
      }
    })
    await ensureCodeServerInstalled()
    expect(spawnMock).toHaveBeenCalledWith(
      'sh',
      [
        '/res/code-server/install.sh',
        '--method',
        'standalone',
        '--prefix',
        '/userData/code-server',
        '--version',
        '4.99.4'
      ],
      expect.objectContaining({ stdio: expect.anything() })
    )
  })
})
