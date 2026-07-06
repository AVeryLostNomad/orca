import { beforeEach, describe, expect, it, vi } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'

const { existsSyncMock, lstatMock, readlinkMock, symlinkMock, mkdirMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  lstatMock: vi.fn(),
  readlinkMock: vi.fn(),
  symlinkMock: vi.fn(),
  mkdirMock: vi.fn()
}))

vi.mock('node:fs', () => ({ existsSync: existsSyncMock }))
vi.mock('node:fs/promises', () => ({
  lstat: lstatMock,
  readlink: readlinkMock,
  symlink: symlinkMock,
  mkdir: mkdirMock
}))
vi.mock('./code-server-paths', () => ({
  getCodeServerUserDataDir: () => '/userData/code-server/user-data'
}))

import { linkVsCodeUserSettings } from './code-server-vscode-settings-link'

const realUserDir =
  process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'Code', 'User')
    : join(homedir(), '.config', 'Code', 'User')

describe('linkVsCodeUserSettings', () => {
  beforeEach(() => {
    ;[existsSyncMock, lstatMock, readlinkMock, symlinkMock, mkdirMock].forEach((m) => m.mockReset())
    mkdirMock.mockResolvedValue(undefined)
    symlinkMock.mockResolvedValue(undefined)
    lstatMock.mockRejectedValue(new Error('ENOENT'))
  })

  it('creates a symlink for an existing real settings.json', async () => {
    existsSyncMock.mockImplementation((p: string) => p === join(realUserDir, 'settings.json'))
    await linkVsCodeUserSettings()
    expect(symlinkMock).toHaveBeenCalledWith(
      join(realUserDir, 'settings.json'),
      join('/userData/code-server/user-data', 'User', 'settings.json')
    )
  })

  it('skips targets that do not exist (no dangling symlink)', async () => {
    existsSyncMock.mockReturnValue(false)
    await linkVsCodeUserSettings()
    expect(symlinkMock).not.toHaveBeenCalled()
  })

  it('never throws when symlink creation fails', async () => {
    existsSyncMock.mockImplementation((p: string) => p === join(realUserDir, 'settings.json'))
    symlinkMock.mockRejectedValue(new Error('EPERM'))
    await expect(linkVsCodeUserSettings()).resolves.toBeUndefined()
  })
})
