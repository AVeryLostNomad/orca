import { beforeEach, describe, expect, it, vi } from 'vitest'

const { gitExecFileAsyncMock } = vi.hoisted(() => ({
  gitExecFileAsyncMock: vi.fn()
}))

vi.mock('./runner', () => ({
  gitExecFileAsync: gitExecFileAsyncMock
}))

import { clearGitCapabilityStateForTests } from './git-capability-state'
import { gitPush } from './remote'

describe('gitPush deleted-remote-branch lease fallback', () => {
  beforeEach(() => {
    gitExecFileAsyncMock.mockReset()
    clearGitCapabilityStateForTests()
  })

  const staleInfoError = new Error(
    'Command failed: git push\n' +
      ' ! [rejected]        HEAD -> feature (stale info)\n' +
      "error: failed to push some refs to 'origin'"
  )

  function mockRepoState(options: { remoteBranchExists: boolean }): void {
    gitExecFileAsyncMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'symbolic-ref') {
        return { stdout: 'feature\n', stderr: '' }
      }
      if (args[0] === 'config' && args.includes('branch.feature.remote')) {
        return { stdout: 'origin\n', stderr: '' }
      }
      if (args[0] === 'config' && args.includes('branch.feature.pushRemote')) {
        throw new Error('missing pushRemote')
      }
      if (args[0] === 'config' && args.includes('remote.pushDefault')) {
        throw new Error('missing pushDefault')
      }
      if (args[0] === 'config' && args.includes('branch.feature.merge')) {
        return { stdout: 'refs/heads/feature\n', stderr: '' }
      }
      if (args[0] === 'config' && args.includes('branch.feature.base')) {
        throw new Error('missing branch base')
      }
      if (args[0] === 'ls-remote') {
        return {
          stdout: options.remoteBranchExists ? 'abc123\trefs/heads/feature\n' : '',
          stderr: ''
        }
      }
      if (args[0] === 'push' && args.includes('--force-with-lease')) {
        throw staleInfoError
      }
      return { stdout: '', stderr: '' }
    })
  }

  it('retries a stale-info lease rejection as a plain push when the remote branch is gone', async () => {
    mockRepoState({ remoteBranchExists: false })

    await gitPush('/repo', false, undefined, { forceWithLease: true })

    const pushCalls = gitExecFileAsyncMock.mock.calls.filter(([args]) => args[0] === 'push')
    expect(pushCalls).toEqual([
      [
        ['push', '--force-with-lease', '--set-upstream', 'origin', 'HEAD:feature'],
        { cwd: '/repo' }
      ],
      [['push', '--set-upstream', 'origin', 'HEAD:feature'], { cwd: '/repo' }]
    ])
    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(
      ['ls-remote', '--heads', 'origin', 'refs/heads/feature'],
      { cwd: '/repo' }
    )
  })

  it('surfaces the stale-info rejection when the remote branch still exists', async () => {
    mockRepoState({ remoteBranchExists: true })

    await expect(gitPush('/repo', false, undefined, { forceWithLease: true })).rejects.toThrow(
      'Push rejected: the remote branch changed since your last fetch (stale info). Fetch and try again.'
    )

    const pushCalls = gitExecFileAsyncMock.mock.calls.filter(([args]) => args[0] === 'push')
    expect(pushCalls).toHaveLength(1)
  })
})
