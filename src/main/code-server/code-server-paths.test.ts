import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { existsSyncMock } = vi.hoisted(() => ({ existsSyncMock: vi.fn() }))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/userData') }
}))
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    existsSync: existsSyncMock
  }
})

import {
  getCodeServerCacheRoot,
  resolveCodeServerExecutable,
  getCodeServerUserDataDir,
  getCodeServerExtensionsDir
} from './code-server-paths'

describe('code-server-paths', () => {
  beforeEach(() => {
    existsSyncMock.mockReset()
    delete process.env.ORCA_CODE_SERVER_PATH
  })
  afterEach(() => vi.restoreAllMocks())

  it('roots the cache under userData', () => {
    expect(getCodeServerCacheRoot()).toBe('/userData/code-server')
    expect(getCodeServerUserDataDir()).toBe('/userData/code-server/user-data')
    expect(getCodeServerExtensionsDir()).toBe('/userData/code-server/extensions')
  })

  it('prefers the env override when it exists on disk', () => {
    process.env.ORCA_CODE_SERVER_PATH = '/custom/code-server'
    existsSyncMock.mockImplementation((p: string) => p === '/custom/code-server')
    expect(resolveCodeServerExecutable()).toBe('/custom/code-server')
  })

  it('falls back to the prefix bin when installed', () => {
    existsSyncMock.mockImplementation((p: string) => p === '/userData/code-server/bin/code-server')
    expect(resolveCodeServerExecutable()).toBe('/userData/code-server/bin/code-server')
  })

  it('returns null when nothing resolves', () => {
    existsSyncMock.mockReturnValue(false)
    expect(resolveCodeServerExecutable()).toBeNull()
  })
})
