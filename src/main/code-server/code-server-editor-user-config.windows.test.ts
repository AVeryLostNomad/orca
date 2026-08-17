import { beforeEach, describe, expect, it, vi } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'

const {
  existsSyncMock,
  lstatMock,
  readlinkMock,
  symlinkMock,
  copyFileMock,
  mkdirMock,
  rmMock,
  preferenceMock
} = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  lstatMock: vi.fn(),
  readlinkMock: vi.fn(),
  symlinkMock: vi.fn(),
  copyFileMock: vi.fn(),
  mkdirMock: vi.fn(),
  rmMock: vi.fn(),
  preferenceMock: vi.fn()
}))

vi.mock('node:fs', () => ({ existsSync: existsSyncMock }))
vi.mock('node:fs/promises', () => ({
  lstat: lstatMock,
  readlink: readlinkMock,
  symlink: symlinkMock,
  copyFile: copyFileMock,
  mkdir: mkdirMock,
  rm: rmMock
}))
vi.mock('./code-server-paths', () => ({
  getCodeServerUserDataDir: () => '/userData/code-server/user-data',
  getCodeServerCacheRoot: () => '/userData/code-server'
}))
vi.mock('./code-server-import-preference', () => ({
  readCodeServerImportPreference: preferenceMock
}))

import { mirrorEditorUserConfig } from './code-server-editor-user-config'

// resolveEditorUserDir on win32 falls back to <home>/AppData/Roaming when
// APPDATA is unset (as on the posix CI hosts running this suite).
const vscodeUserDir =
  process.env.APPDATA && process.platform === 'win32'
    ? join(process.env.APPDATA, 'Code', 'User')
    : join(homedir(), 'AppData', 'Roaming', 'Code', 'User')
const destUserDir = join('/userData/code-server/user-data', 'User')

function epermError(): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error('EPERM: operation not permitted')
  error.code = 'EPERM'
  return error
}

describe('mirrorEditorUserConfig on win32', () => {
  beforeEach(() => {
    ;[
      existsSyncMock,
      lstatMock,
      readlinkMock,
      symlinkMock,
      copyFileMock,
      mkdirMock,
      rmMock
    ].forEach((m) => m.mockReset())
    preferenceMock.mockReset()
    preferenceMock.mockResolvedValue({})
    mkdirMock.mockResolvedValue(undefined)
    symlinkMock.mockResolvedValue(undefined)
    copyFileMock.mockResolvedValue(undefined)
    rmMock.mockResolvedValue(undefined)
    lstatMock.mockRejectedValue(new Error('ENOENT'))
    existsSyncMock.mockReturnValue(true)
  })

  it('creates the snippets dir link as a junction (unprivileged on Windows)', async () => {
    await mirrorEditorUserConfig({ platform: 'win32' })
    expect(symlinkMock).toHaveBeenCalledWith(
      join(vscodeUserDir, 'snippets'),
      join(destUserDir, 'snippets'),
      'junction'
    )
  })

  it('falls back to a copy when a file symlink needs Developer Mode (EPERM)', async () => {
    symlinkMock.mockImplementation((_target: string, _link: string, type?: string) =>
      type === 'junction' ? Promise.resolve() : Promise.reject(epermError())
    )
    await mirrorEditorUserConfig({ platform: 'win32' })
    for (const entry of ['settings.json', 'keybindings.json']) {
      expect(copyFileMock).toHaveBeenCalledWith(
        join(vscodeUserDir, entry),
        join(destUserDir, entry)
      )
    }
  })

  it('re-copies an existing copy-mode mirror on every run so it tracks the source', async () => {
    symlinkMock.mockImplementation((_target: string, _link: string, type?: string) =>
      type === 'junction' ? Promise.resolve() : Promise.reject(epermError())
    )
    lstatMock.mockImplementation((linkPath: string) =>
      linkPath === join(destUserDir, 'settings.json')
        ? Promise.resolve({ isSymbolicLink: () => false, isDirectory: () => false })
        : Promise.reject(new Error('ENOENT'))
    )
    await mirrorEditorUserConfig({ platform: 'win32' })
    expect(rmMock).toHaveBeenCalledWith(join(destUserDir, 'settings.json'), { force: true })
    expect(copyFileMock).toHaveBeenCalledWith(
      join(vscodeUserDir, 'settings.json'),
      join(destUserDir, 'settings.json')
    )
  })

  it('upgrades a copy to a symlink once file symlinks become possible', async () => {
    lstatMock.mockImplementation((linkPath: string) =>
      linkPath === join(destUserDir, 'settings.json')
        ? Promise.resolve({ isSymbolicLink: () => false, isDirectory: () => false })
        : Promise.reject(new Error('ENOENT'))
    )
    await mirrorEditorUserConfig({ platform: 'win32' })
    expect(symlinkMock).toHaveBeenCalledWith(
      join(vscodeUserDir, 'settings.json'),
      join(destUserDir, 'settings.json')
    )
    expect(copyFileMock).not.toHaveBeenCalled()
  })

  it('leaves a correct junction alone despite \\\\?\\ prefixes, case, and trailing separators', async () => {
    lstatMock.mockImplementation((linkPath: string) =>
      linkPath === join(destUserDir, 'snippets')
        ? Promise.resolve({ isSymbolicLink: () => true, isDirectory: () => false })
        : Promise.reject(new Error('ENOENT'))
    )
    readlinkMock.mockResolvedValue(`\\\\?\\${join(vscodeUserDir, 'snippets').toUpperCase()}\\`)
    await mirrorEditorUserConfig({ platform: 'win32' })
    expect(rmMock).not.toHaveBeenCalledWith(join(destUserDir, 'snippets'), expect.anything())
    expect(symlinkMock).not.toHaveBeenCalledWith(
      expect.anything(),
      join(destUserDir, 'snippets'),
      'junction'
    )
  })
})
