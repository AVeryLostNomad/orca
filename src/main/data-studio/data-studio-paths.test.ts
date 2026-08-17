import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/userData') }
}))

import {
  getDataStudioRoot,
  getDataStudioProfilesRoot,
  getDataStudioProfileDir,
  getDataStudioProfileUserDataDir,
  getDataStudioProfilePidFilePath,
  getDataStudioExtensionsDir,
  getDataStudioPortsFilePath,
  getDataStudioPartition,
  hashRepoId
} from './data-studio-paths'

const REPO_ID = 'repo-1::/Users/someone/code/my repo'
const HASH = createHash('sha256').update(REPO_ID).digest('hex').slice(0, 16)

describe('data-studio-paths', () => {
  it('hashes repo ids to 16 hex chars (repo ids are path-derived and fs-hostile)', () => {
    expect(hashRepoId(REPO_ID)).toBe(HASH)
    expect(hashRepoId(REPO_ID)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('roots everything under userData/data-studio', () => {
    expect(getDataStudioRoot()).toBe('/userData/data-studio')
    expect(getDataStudioProfilesRoot()).toBe('/userData/data-studio/profiles')
    expect(getDataStudioExtensionsDir()).toBe('/userData/data-studio/extensions')
    expect(getDataStudioPortsFilePath()).toBe('/userData/data-studio/ports.json')
  })

  it('lays out per-repo profile dirs by hash', () => {
    expect(getDataStudioProfileDir(REPO_ID)).toBe(`/userData/data-studio/profiles/${HASH}`)
    expect(getDataStudioProfileUserDataDir(REPO_ID)).toBe(
      `/userData/data-studio/profiles/${HASH}/user-data`
    )
    expect(getDataStudioProfilePidFilePath(REPO_ID)).toBe(
      `/userData/data-studio/profiles/${HASH}/code-server.pid`
    )
  })

  it('derives a stable per-repo partition distinct across repos', () => {
    expect(getDataStudioPartition(REPO_ID)).toBe(`persist:orca-datastudio-${HASH}`)
    expect(getDataStudioPartition('other-repo::/elsewhere')).not.toBe(
      getDataStudioPartition(REPO_ID)
    )
  })
})
