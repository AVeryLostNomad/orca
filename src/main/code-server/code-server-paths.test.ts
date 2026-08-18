import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import type * as NodeFs from 'node:fs'

const { existsSyncMock, readFileSyncMock, statSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  statSyncMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/userData') }
}))
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof NodeFs>()
  return {
    ...original,
    existsSync: existsSyncMock,
    readFileSync: readFileSyncMock,
    statSync: statSyncMock
  }
})

import {
  CODE_SERVER_VERSION,
  CODE_SERVER_WINDOWS_PACKAGE_REVISION,
  CODE_SERVER_WINDOWS_REVISION_STAMP,
  getCodeServerCacheRoot,
  getCodeServerExtensionsDir,
  getCodeServerUserDataDir,
  getCodeServerVersionRoot,
  resolveCodeServerLaunch,
  resolveCodeServerProductJson
} from './code-server-paths'

const versionRoot = join('/userData/code-server/lib', `code-server-${CODE_SERVER_VERSION}`)
const revisionStamp = join(versionRoot, CODE_SERVER_WINDOWS_REVISION_STAMP)

function stampRevision(value: string): void {
  readFileSyncMock.mockImplementation((p: string) => {
    if (p === revisionStamp) {
      return value
    }
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  })
}

describe('code-server-paths', () => {
  beforeEach(() => {
    existsSyncMock.mockReset()
    readFileSyncMock.mockReset()
    statSyncMock.mockReset()
    statSyncMock.mockReturnValue({ isDirectory: () => false })
    stampRevision(`${CODE_SERVER_WINDOWS_PACKAGE_REVISION}\n`)
    delete process.env.ORCA_CODE_SERVER_PATH
  })
  afterEach(() => vi.restoreAllMocks())

  it('roots the cache under userData', () => {
    expect(getCodeServerCacheRoot()).toBe('/userData/code-server')
    expect(getCodeServerUserDataDir()).toBe('/userData/code-server/user-data')
    expect(getCodeServerExtensionsDir()).toBe('/userData/code-server/extensions')
    expect(getCodeServerVersionRoot()).toBe(versionRoot)
  })

  it('prefers a file env override when it exists on disk', () => {
    process.env.ORCA_CODE_SERVER_PATH = '/custom/code-server'
    existsSyncMock.mockImplementation((p: string) => p === '/custom/code-server')
    expect(resolveCodeServerLaunch('linux')).toEqual({
      command: '/custom/code-server',
      args: [],
      root: null
    })
  })

  it('accepts a directory env override with the node+entry package layout', () => {
    process.env.ORCA_CODE_SERVER_PATH = '/unpacked'
    statSyncMock.mockReturnValue({ isDirectory: () => true })
    const node = join('/unpacked', 'lib', 'node.exe')
    const entry = join('/unpacked', 'out', 'node', 'entry.js')
    existsSyncMock.mockImplementation((p: string) => [node, entry, '/unpacked'].includes(p))
    expect(resolveCodeServerLaunch('win32')).toEqual({
      command: node,
      args: [entry],
      root: '/unpacked'
    })
  })

  it('resolves the versioned bin on posix', () => {
    const bin = join(versionRoot, 'bin', 'code-server')
    existsSyncMock.mockImplementation((p: string) => p === bin)
    expect(resolveCodeServerLaunch('linux')).toEqual({ command: bin, args: [], root: versionRoot })
  })

  it('falls back to the prefix bin when installed', () => {
    existsSyncMock.mockImplementation((p: string) => p === '/userData/code-server/bin/code-server')
    expect(resolveCodeServerLaunch('linux')).toEqual({
      command: '/userData/code-server/bin/code-server',
      args: [],
      root: null
    })
  })

  it('resolves node.exe + entry.js on win32 and requires both', () => {
    const node = join(versionRoot, 'lib', 'node.exe')
    const entry = join(versionRoot, 'out', 'node', 'entry.js')
    existsSyncMock.mockImplementation((p: string) => p === node || p === entry)
    expect(resolveCodeServerLaunch('win32')).toEqual({
      command: node,
      args: [entry],
      root: versionRoot
    })

    existsSyncMock.mockImplementation((p: string) => p === node)
    expect(resolveCodeServerLaunch('win32')).toBeNull()
  })

  // The install dir is named by upstream version only, so the revision stamp is
  // what lets a package-revision bump evict a previously extracted tree.
  it('treats a missing or stale win32 revision stamp as not installed', () => {
    const node = join(versionRoot, 'lib', 'node.exe')
    const entry = join(versionRoot, 'out', 'node', 'entry.js')
    existsSyncMock.mockImplementation((p: string) => p === node || p === entry)

    stampRevision(`${CODE_SERVER_WINDOWS_PACKAGE_REVISION - 1}\n`)
    expect(resolveCodeServerLaunch('win32')).toBeNull()

    readFileSyncMock.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    expect(resolveCodeServerLaunch('win32')).toBeNull()

    // Env-override directories are a dev escape hatch and skip the stamp check.
    process.env.ORCA_CODE_SERVER_PATH = '/unpacked'
    statSyncMock.mockReturnValue({ isDirectory: () => true })
    const overrideNode = join('/unpacked', 'lib', 'node.exe')
    const overrideEntry = join('/unpacked', 'out', 'node', 'entry.js')
    existsSyncMock.mockImplementation((p: string) =>
      ['/unpacked', overrideNode, overrideEntry].includes(p)
    )
    expect(resolveCodeServerLaunch('win32')).not.toBeNull()
  })

  it('returns null when nothing resolves', () => {
    existsSyncMock.mockReturnValue(false)
    expect(resolveCodeServerLaunch('linux')).toBeNull()
    expect(resolveCodeServerLaunch('win32')).toBeNull()
  })

  it('derives product.json from the launch root', () => {
    const node = join(versionRoot, 'lib', 'node.exe')
    const entry = join(versionRoot, 'out', 'node', 'entry.js')
    const productJson = join(versionRoot, 'lib', 'vscode', 'product.json')
    const isWin = process.platform === 'win32'
    // resolveCodeServerProductJson resolves for the *host* platform; feed the
    // matching launch layout so the test is host-independent.
    const bin = join(versionRoot, 'bin', 'code-server')
    existsSyncMock.mockImplementation((p: string) =>
      [productJson, ...(isWin ? [node, entry] : [bin])].includes(p)
    )
    expect(resolveCodeServerProductJson()).toBe(productJson)
  })
})
