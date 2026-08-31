import { describe, expect, it } from 'vitest'
import {
  formatCreateProjectParentSummary,
  getCreateProjectDefaultParentAutoFill,
  getCreateProjectParentTargetKey,
  getDefaultCreateProjectParent,
  joinCreateProjectPath,
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
describe('create project defaults', () => {
  it('builds the POSIX default project parent', () => {
    expect(getDefaultCreateProjectParent('/Users/alice')).toBe('/Users/alice/orca/projects')
  })

  it('builds the Windows default project parent', () => {
    expect(getDefaultCreateProjectParent('C:\\Users\\alice')).toBe(
      'C:\\Users\\alice\\orca\\projects'
    )
  })

  it('derives the runtime project default from a resolved server home', () => {
    expect(getDefaultCreateProjectParent('/home/alice')).toBe('/home/alice/orca/projects')
  })

  it('scopes the remembered parent to its execution host', () => {
    const storage = createMemoryStorage()
    rememberCreateProjectParent('local', ' /Users/alice/code ', storage)
    rememberCreateProjectParent('runtime:env-1', '/srv/code', storage)

    expect(readLastCreateProjectParent('local', storage)).toBe('/Users/alice/code')
    expect(readLastCreateProjectParent('runtime:env-1', storage)).toBe('/srv/code')
    expect(readLastCreateProjectParent('ssh:ssh-1', storage)).toBeNull()
  })

  it('builds stable parent-history keys for local, runtime, and SSH hosts', () => {
    expect(getCreateProjectParentTargetKey({})).toBe('local')
    expect(getCreateProjectParentTargetKey({ runtimeEnvironmentId: ' env-1 ' })).toBe(
      'runtime:env-1'
    )
    expect(getCreateProjectParentTargetKey({ sshTargetId: ' ssh-1 ' })).toBe('ssh:ssh-1')
  })

  it('joins path previews without mixing separators', () => {
    expect(joinCreateProjectPath('/home/alice/orca/projects', 'demo')).toBe(
      '/home/alice/orca/projects/demo'
    )
    expect(joinCreateProjectPath('C:\\Users\\alice\\orca\\projects', 'demo')).toBe(
      'C:\\Users\\alice\\orca\\projects\\demo'
    )
  })

  it('auto-fills only the first empty local create step', () => {
    expect(
      getCreateProjectDefaultParentAutoFill({
        step: 'create',
        createParent: '',
        activeRuntimeEnvironmentId: null,
        defaultParent: '/Users/alice/orca/projects',
        createStepAutoFilled: false
      })
    ).toEqual({ parent: '/Users/alice/orca/projects' })
    expect(
      getCreateProjectDefaultParentAutoFill({
        step: 'create',
        createParent: '/tmp/project',
        activeRuntimeEnvironmentId: null,
        defaultParent: '/Users/alice/orca/projects',
        createStepAutoFilled: false
      })
    ).toBeNull()
    expect(
      getCreateProjectDefaultParentAutoFill({
        step: 'create',
        createParent: '',
        activeRuntimeEnvironmentId: null,
        defaultParent: '/Users/alice/orca/projects',
        createStepAutoFilled: true
      })
    ).toBeNull()
  })

  it('does not apply a local default while a runtime environment is active', () => {
    expect(
      getCreateProjectDefaultParentAutoFill({
        step: 'create',
        createParent: '',
        activeRuntimeEnvironmentId: 'env-1',
        defaultParent: '/Users/alice/orca/projects',
        createStepAutoFilled: false
      })
    ).toBeNull()
  })

  it('uses a short local summary only for the local default parent', () => {
    expect(
      formatCreateProjectParentSummary({
        parent: '/Users/alice/orca/projects',
        defaultParent: '/Users/alice/orca/projects'
      })
    ).toBe('~/orca/projects')
    expect(
      formatCreateProjectParentSummary({
        parent: '',
        defaultParent: '',
        runtimeEnvironmentId: 'env-1'
      })
    ).toBe('host folder not selected')
    expect(
      formatCreateProjectParentSummary({
        parent: '/Users/alice/orca/projects',
        defaultParent: '/Users/alice/orca/projects',
        isRemoteHost: true
      })
    ).toBe('/Users/alice/orca/projects')
    expect(
      formatCreateProjectParentSummary({
        parent: '',
        defaultParent: '',
        isRemoteHost: true
      })
    ).toBe('host folder not selected')
  })
})
