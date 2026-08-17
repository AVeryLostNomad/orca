import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  spawnMock,
  resolveLaunchMock,
  resolveScriptMock,
  cacheRootMock,
  renameMock,
  mkdirMock,
  windowsInstallMock
} = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  resolveLaunchMock: vi.fn(),
  resolveScriptMock: vi.fn(),
  cacheRootMock: vi.fn(() => '/userData/code-server'),
  renameMock: vi.fn(() => Promise.resolve()),
  mkdirMock: vi.fn(() => Promise.resolve()),
  windowsInstallMock: vi.fn(() => Promise.resolve())
}))

vi.mock('node:child_process', () => ({ spawn: spawnMock }))
vi.mock('node:os', () => ({ tmpdir: () => '/tmp' }))
vi.mock('node:fs/promises', () => ({
  mkdir: mkdirMock,
  rename: renameMock,
  rm: vi.fn(() => Promise.resolve())
}))
vi.mock('./code-server-paths', () => ({
  CODE_SERVER_VERSION: '4.127.0',
  getCodeServerCacheRoot: cacheRootMock,
  resolveCodeServerLaunch: resolveLaunchMock,
  resolveCodeServerInstallScript: resolveScriptMock
}))
vi.mock('./code-server-windows-install', () => ({
  installCodeServerWindows: windowsInstallMock
}))

function launchFor(command: string): { command: string; args: string[]; root: null } {
  return { command, args: [], root: null }
}

// Drives spawn's 'close' listener with the given exit code (and optional stderr).
function mockSpawnExit(code: number, stderr?: string): void {
  spawnMock.mockImplementation(() => ({
    stdout: { on: vi.fn() },
    stderr: {
      on: (event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data' && stderr) {
          setTimeout(() => cb(Buffer.from(stderr)), 0)
        }
      }
    },
    on: (event: string, cb: (arg: number) => void) => {
      if (event === 'close') {
        setTimeout(() => cb(code), stderr ? 10 : 0)
      }
    }
  }))
}

import { ensureCodeServerInstalled, CodeServerInstallError } from './code-server-installer'

describe('ensureCodeServerInstalled', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    resolveLaunchMock.mockReset()
    resolveScriptMock.mockReset()
    cacheRootMock.mockReset()
    cacheRootMock.mockReturnValue('/userData/code-server')
    renameMock.mockReset()
    renameMock.mockResolvedValue(undefined)
    mkdirMock.mockReset()
    mkdirMock.mockResolvedValue(undefined)
    windowsInstallMock.mockReset()
    windowsInstallMock.mockResolvedValue(undefined)
  })

  it('is idempotent: skips install when the executable already resolves', async () => {
    resolveLaunchMock.mockReturnValue(launchFor('/userData/code-server/bin/code-server'))
    const launch = await ensureCodeServerInstalled()
    expect(launch.command).toBe('/userData/code-server/bin/code-server')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('delegates to the Windows package installer on win32 and never consults install.sh', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    try {
      resolveLaunchMock
        .mockReturnValueOnce(null)
        .mockReturnValue(launchFor('/userData/code-server/lib/node.exe'))
      await ensureCodeServerInstalled()
      expect(windowsInstallMock).toHaveBeenCalledTimes(1)
      expect(resolveScriptMock).not.toHaveBeenCalled()
      expect(spawnMock).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  })

  it('throws no-install-script when the vendored script is missing', async () => {
    resolveLaunchMock.mockReturnValue(null)
    resolveScriptMock.mockReturnValue(null)
    await expect(ensureCodeServerInstalled()).rejects.toMatchObject({
      code: 'no-install-script'
    })
    expect(CodeServerInstallError).toBeDefined()
  })

  it('spawns sh install.sh with standalone/prefix/version flags', async () => {
    // First resolve null (not installed), then the path after install.
    resolveLaunchMock
      .mockReturnValueOnce(null)
      .mockReturnValue(launchFor('/userData/code-server/bin/code-server'))
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
        '4.127.0'
      ],
      expect.objectContaining({ stdio: expect.anything() })
    )
  })

  it('classifies unsupported-arch by the install.sh sentinel message', async () => {
    resolveLaunchMock.mockReturnValue(null)
    resolveScriptMock.mockReturnValue('/res/code-server/install.sh')
    mockSpawnExit(1, 'There are no standalone releases for riscv64')
    await expect(ensureCodeServerInstalled()).rejects.toMatchObject({
      code: 'unsupported-arch'
    })
  })

  it('installs to a space-free staging prefix and relocates when userData has a space', async () => {
    // macOS userData lives under "Application Support" — a space that install.sh's
    // sh_c would re-split, escalating to sudo. The installer must instead point
    // --prefix at a space-free staging dir and relocate the result itself.
    const spaceRoot = '/Users/x/Library/Application Support/orca/code-server'
    cacheRootMock.mockReturnValue(spaceRoot)
    resolveLaunchMock
      .mockReturnValueOnce(null)
      .mockReturnValue(launchFor(`${spaceRoot}/bin/code-server`))
    resolveScriptMock.mockReturnValue('/res/code-server/install.sh')
    mockSpawnExit(0)

    await ensureCodeServerInstalled()

    // install.sh got a whitespace-free prefix (the staging dir), never the real one.
    const [, args] = spawnMock.mock.calls[0]
    const prefixIndex = (args as string[]).indexOf('--prefix')
    const passedPrefix = (args as string[])[prefixIndex + 1]
    expect(passedPrefix).toBe('/tmp/orca-code-server-install')
    expect(passedPrefix).not.toMatch(/\s/)

    // the versioned tree was relocated into the real (spaced) location via fs.rename.
    expect(renameMock).toHaveBeenCalledWith(
      '/tmp/orca-code-server-install/lib/code-server-4.127.0',
      `${spaceRoot}/lib/code-server-4.127.0`
    )
  })

  it('installs directly (no staging) when the real prefix has no spaces', async () => {
    resolveLaunchMock
      .mockReturnValueOnce(null)
      .mockReturnValue(launchFor('/userData/code-server/bin/code-server'))
    resolveScriptMock.mockReturnValue('/res/code-server/install.sh')
    mockSpawnExit(0)

    await ensureCodeServerInstalled()

    const [, args] = spawnMock.mock.calls[0]
    const prefixIndex = (args as string[]).indexOf('--prefix')
    expect((args as string[])[prefixIndex + 1]).toBe('/userData/code-server')
    expect(renameMock).not.toHaveBeenCalled()
  })
})
