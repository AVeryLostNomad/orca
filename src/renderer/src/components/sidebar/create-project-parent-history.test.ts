import { describe, expect, it } from 'vitest'
import {
  getCreateProjectParentTargetKey,
  readLastCreateProjectParent,
  rememberCreateProjectParent
} from './create-project-defaults'

function createMemoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    }
  }
}

describe('create project parent history', () => {
  it('scopes the remembered parent to its execution host', () => {
    const storage = createMemoryStorage()
    rememberCreateProjectParent('local', ' /Users/alice/code ', storage)
    rememberCreateProjectParent('runtime:env-1', '/srv/code', storage)

    expect(readLastCreateProjectParent('local', storage)).toBe('/Users/alice/code')
    expect(readLastCreateProjectParent('runtime:env-1', storage)).toBe('/srv/code')
    expect(readLastCreateProjectParent('ssh:ssh-1', storage)).toBeNull()
  })

  it('builds stable parent-history keys for local and runtime hosts', () => {
    expect(getCreateProjectParentTargetKey({})).toBe('local')
    expect(getCreateProjectParentTargetKey({ runtimeEnvironmentId: ' env-1 ' })).toBe(
      'runtime:env-1'
    )
  })
})
