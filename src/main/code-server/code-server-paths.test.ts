import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import type * as NodeFs from 'node:fs'

const { existsSyncMock, statSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
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
    statSync: statSyncMock
  }
})

import {
  CODE_SERVER_VERSION,
  getCodeServerCacheRoot,
  getCodeServerExtensionsDir,
  getCodeServerUserDataDir,
  getCodeServerVersionRoot,
  resolveCodeServerLaunch,
  resolveCodeServerProductJson
} from './code-server-paths'

const versionRoot = join('/userData/code-server/lib', `code-server-${CODE_SERVER_VERSION}`)

describe('code-server-paths', () => {
  beforeEach(() => {
    existsSyncMock.mockReset()
    statSyncMock.mockReset()
    statSyncMock.mockReturnValue({ isDirectory: () => false })
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
