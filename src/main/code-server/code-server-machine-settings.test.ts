import { beforeEach, describe, expect, it, vi } from 'vitest'

const { readFileMock, writeFileMock, mkdirMock, userDataDirMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  writeFileMock: vi.fn<(path: string, contents: string) => Promise<void>>(() => Promise.resolve()),
  mkdirMock: vi.fn(() => Promise.resolve()),
  userDataDirMock: vi.fn(() => '/root/user-data')
}))

vi.mock('node:fs/promises', () => ({
  readFile: readFileMock,
  writeFile: writeFileMock,
  mkdir: mkdirMock
}))
vi.mock('./code-server-paths', () => ({ getCodeServerUserDataDir: userDataDirMock }))

import {
  applyCodeServerMachineSettings,
  CODE_SERVER_MACHINE_SETTINGS
} from './code-server-machine-settings'

const SETTINGS_PATH = '/root/user-data/Machine/settings.json'

describe('applyCodeServerMachineSettings', () => {
  beforeEach(() => {
    readFileMock.mockReset()
    writeFileMock.mockReset()
    writeFileMock.mockResolvedValue(undefined)
    mkdirMock.mockClear()
  })

  it('writes all defaults when the file is missing', async () => {
    readFileMock.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await applyCodeServerMachineSettings()
    expect(mkdirMock).toHaveBeenCalledWith('/root/user-data/Machine', { recursive: true })
    const [path, contents] = writeFileMock.mock.calls[0]
    expect(path).toBe(SETTINGS_PATH)
    expect(JSON.parse(contents as string)).toEqual(CODE_SERVER_MACHINE_SETTINGS)
  })

  it('preserves hand-added keys while enforcing Orca defaults', async () => {
    readFileMock.mockResolvedValue(JSON.stringify({ 'editor.fontSize': 13, 'git.enabled': true }))
    await applyCodeServerMachineSettings()
    const written = JSON.parse(writeFileMock.mock.calls[0][1] as string)
    expect(written).toEqual({ 'editor.fontSize': 13, ...CODE_SERVER_MACHINE_SETTINGS })
  })

  it('is idempotent: does not rewrite when every default is already applied', async () => {
    readFileMock.mockResolvedValue(JSON.stringify({ ...CODE_SERVER_MACHINE_SETTINGS }))
    await applyCodeServerMachineSettings()
    expect(writeFileMock).not.toHaveBeenCalled()
  })

  it('rewrites from defaults when the file is malformed JSON', async () => {
    readFileMock.mockResolvedValue('{ not json')
    await applyCodeServerMachineSettings()
    const written = JSON.parse(writeFileMock.mock.calls[0][1] as string)
    expect(written).toEqual(CODE_SERVER_MACHINE_SETTINGS)
  })

  it('does not throw when the write fails', async () => {
    readFileMock.mockRejectedValue(new Error('ENOENT'))
    writeFileMock.mockRejectedValue(new Error('EACCES'))
    await expect(applyCodeServerMachineSettings()).resolves.toBeUndefined()
  })
})
