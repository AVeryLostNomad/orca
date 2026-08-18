import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Cache root deliberately contains a space and an apostrophe: extractor argv
// and PowerShell quoting must survive both.
const CACHE_ROOT = join('C:\\Users', "First Last's PC", 'Orca', 'code-server')
const VERSION_ROOT = join(CACHE_ROOT, 'lib', 'code-server-4.127.0')
const ZIP_CONTENT = Buffer.from('not really a zip, but hashable')

const { pkgState, fsPromisesMocks, createReadStreamMock } = vi.hoisted(() => ({
  pkgState: { sha256: '' },
  fsPromisesMocks: {
    mkdir: vi.fn(() => Promise.resolve()),
    readdir: vi.fn(),
    rename: vi.fn(() => Promise.resolve()),
    rm: vi.fn(() => Promise.resolve()),
    stat: vi.fn(),
    writeFile: vi.fn(() => Promise.resolve())
  },
  createReadStreamMock: vi.fn()
}))

vi.mock('./code-server-paths', () => ({
  CODE_SERVER_VERSION: '4.127.0',
  CODE_SERVER_WINDOWS_PACKAGE_REVISION: 2,
  CODE_SERVER_WINDOWS_REVISION_STAMP: 'orca-package-revision',
  getCodeServerCacheRoot: () => CACHE_ROOT,
  getCodeServerVersionRoot: () => VERSION_ROOT
}))
vi.mock('./code-server-windows-package', () => ({
  CODE_SERVER_WINDOWS_ASSET_NAME: 'code-server-4.127.0-windows-amd64.zip',
  CODE_SERVER_WINDOWS_DOWNLOAD_URL:
    'https://github.com/example/releases/code-server-4.127.0-windows-amd64.zip',
  CODE_SERVER_WINDOWS_MIN_VALID_BYTES: 10,
  get CODE_SERVER_WINDOWS_SHA256() {
    return pkgState.sha256
  }
}))
vi.mock('node:fs/promises', () => fsPromisesMocks)
vi.mock('node:fs', () => ({
  createReadStream: createReadStreamMock,
  createWriteStream: vi.fn()
}))

import { installCodeServerWindows } from './code-server-windows-install'

const DOWNLOADS = join(CACHE_ROOT, 'downloads')
const ZIP = join(DOWNLOADS, 'code-server-4.127.0-windows-amd64.zip')
const STAGING = join(CACHE_ROOT, 'lib', '.staging-4.127.0')

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void

function makeExec(
  impl: (file: string, args: string[]) => { error: Error | null; stderr?: string }
): ReturnType<typeof vi.fn> {
  return vi.fn((file: string, args: string[], _opts: unknown, cb: ExecCallback) => {
    const { error, stderr } = impl(file, args)
    cb(error, '', stderr ?? '')
  })
}

describe('installCodeServerWindows', () => {
  beforeEach(() => {
    Object.values(fsPromisesMocks).forEach((m) => m.mockReset())
    fsPromisesMocks.mkdir.mockResolvedValue(undefined)
    fsPromisesMocks.rename.mockResolvedValue(undefined)
    fsPromisesMocks.rm.mockResolvedValue(undefined)
    fsPromisesMocks.stat.mockResolvedValue({ size: ZIP_CONTENT.length })
    fsPromisesMocks.readdir.mockResolvedValue([
      { name: 'code-server-4.127.0-windows-amd64', isDirectory: () => true }
    ])
    createReadStreamMock.mockReset()
    createReadStreamMock.mockImplementation(() => Readable.from([ZIP_CONTENT]))
    pkgState.sha256 = createHash('sha256').update(ZIP_CONTENT).digest('hex')
  })

  it('downloads, verifies, extracts via System32 tar.exe, and renames into place', async () => {
    const download = vi.fn(() => Promise.resolve())
    const execFileImpl = makeExec(() => ({ error: null }))
    const progress: number[] = []

    await installCodeServerWindows((f) => progress.push(f), {
      downloadImpl: download,
      execFileImpl: execFileImpl as never,
      env: { SystemRoot: 'C:\\Windows' }
    })

    expect(download).toHaveBeenCalledWith(
      'https://github.com/example/releases/code-server-4.127.0-windows-amd64.zip',
      `${ZIP}.partial`,
      expect.any(Function)
    )
    expect(execFileImpl).toHaveBeenCalledWith(
      join('C:\\Windows', 'System32', 'tar.exe'),
      ['-xf', ZIP, '-C', STAGING],
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function)
    )
    expect(fsPromisesMocks.rename).toHaveBeenCalledWith(
      join(STAGING, 'code-server-4.127.0-windows-amd64'),
      VERSION_ROOT
    )
    // Revision stamp lands inside the staged tree before the rename.
    expect(fsPromisesMocks.writeFile).toHaveBeenCalledWith(
      join(STAGING, 'code-server-4.127.0-windows-amd64', 'orca-package-revision'),
      '2\n',
      'utf8'
    )
    const writeOrder = fsPromisesMocks.writeFile.mock.invocationCallOrder[0]
    const renameCalls = fsPromisesMocks.rename.mock.calls as unknown as [string, string][]
    const renameToRootOrder =
      fsPromisesMocks.rename.mock.invocationCallOrder[
        renameCalls.findIndex(([, to]) => to === VERSION_ROOT)
      ]
    expect(writeOrder).toBeLessThan(renameToRootOrder)
    // zip + staging removed on success
    expect(fsPromisesMocks.rm).toHaveBeenCalledWith(ZIP, { force: true })
    expect(fsPromisesMocks.rm).toHaveBeenCalledWith(STAGING, { recursive: true, force: true })
    expect(progress.at(-1)).toBeLessThanOrEqual(1)
  })

  it('rejects a checksum mismatch, cleaning up every install target', async () => {
    pkgState.sha256 = 'f'.repeat(64)
    const download = vi.fn(() => Promise.resolve())

    await expect(
      installCodeServerWindows(undefined, {
        downloadImpl: download,
        execFileImpl: makeExec(() => ({ error: null })) as never
      })
    ).rejects.toMatchObject({ code: 'checksum-mismatch' })

    for (const target of [`${ZIP}.partial`, ZIP, STAGING, VERSION_ROOT]) {
      expect(fsPromisesMocks.rm).toHaveBeenCalledWith(
        target,
        expect.objectContaining({ force: true })
      )
    }
  })

  it('falls back to Expand-Archive with single-quote-escaped literals when tar.exe fails', async () => {
    const execFileImpl = makeExec((file) =>
      file.endsWith('tar.exe') ? { error: new Error('ENOENT'), stderr: '' } : { error: null }
    )

    await installCodeServerWindows(undefined, {
      downloadImpl: vi.fn(() => Promise.resolve()),
      execFileImpl: execFileImpl as never,
      env: { SystemRoot: 'C:\\Windows' }
    })

    const psCall = execFileImpl.mock.calls.find(([file]) => file === 'powershell.exe')
    expect(psCall).toBeDefined()
    const [, psArgs] = psCall as [string, string[]]
    expect(psArgs.slice(0, 4)).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass'
    ])
    const command = psArgs.at(-1) as string
    // The apostrophe in the cache root must arrive doubled inside the literal.
    expect(command).toContain(`-LiteralPath '${ZIP.replaceAll("'", "''")}'`)
    expect(command).toContain(`-DestinationPath '${STAGING.replaceAll("'", "''")}'`)
  })

  it('fails with missing-prereq when no extractor works', async () => {
    await expect(
      installCodeServerWindows(undefined, {
        downloadImpl: vi.fn(() => Promise.resolve()),
        execFileImpl: makeExec(() => ({
          error: new Error('boom'),
          stderr: 'no extractor'
        })) as never
      })
    ).rejects.toMatchObject({ code: 'missing-prereq' })
    expect(fsPromisesMocks.rm).toHaveBeenCalledWith(
      VERSION_ROOT,
      expect.objectContaining({ force: true })
    )
  })

  it('refuses to install while the sha256 pin is unset', async () => {
    pkgState.sha256 = ''
    const download = vi.fn(() => Promise.resolve())
    await expect(
      installCodeServerWindows(undefined, { downloadImpl: download })
    ).rejects.toMatchObject({ code: 'download-failed' })
    expect(download).not.toHaveBeenCalled()
  })

  it('surfaces an unexpected zip layout as download-failed', async () => {
    fsPromisesMocks.readdir.mockResolvedValue([])
    await expect(
      installCodeServerWindows(undefined, {
        downloadImpl: vi.fn(() => Promise.resolve()),
        execFileImpl: makeExec(() => ({ error: null })) as never
      })
    ).rejects.toMatchObject({ code: 'download-failed' })
  })
})
