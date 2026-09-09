import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as GitRunner from '../git/runner'
import type * as GithubAccountEnv from '../github/github-account-env'

const mocks = await vi.hoisted(async () => {
  // Hoisted mock factories run before static imports initialize.
  const { createGitHubIpcMocks } = await import('./github-ipc-module-mocks')
  return {
    ...createGitHubIpcMocks(),
    invoke: vi.fn(),
    ghExecFileAsync: vi.fn(),
    resolveGithubAccountToken: vi.fn()
  }
})

vi.mock('electron', () => ({ ...mocks.electron, ipcRenderer: { invoke: mocks.invoke } }))
vi.mock('../github/client', () => mocks.client)
vi.mock('../github/work-item-details', () => mocks.workItemDetails)
vi.mock('../github/pr-refresh-coordinator', () => mocks.prRefresh)
vi.mock('../telemetry/client', () => mocks.telemetry)
vi.mock('../telemetry/cohort-classifier', () => mocks.cohort)
vi.mock('./ui', () => mocks.ui)
vi.mock('../git/runner', async (importOriginal) => ({
  ...(await importOriginal<typeof GitRunner>()),
  ghExecFileAsync: mocks.ghExecFileAsync
}))
vi.mock('../github/github-account-env', async (importOriginal) => ({
  ...(await importOriginal<typeof GithubAccountEnv>()),
  resolveGithubAccountToken: mocks.resolveGithubAccountToken
}))

import { ghMutationsAndProjectsApi } from '../../preload/api/gh-bridge-mutations-and-projects'
import { registerGitHubHandlers } from './github'
import { createGitHubIpcHarness } from './github-ipc-test-harness'

describe('GitHub author identity IPC', () => {
  const harness = createGitHubIpcHarness(mocks)

  beforeEach(() => {
    harness.reset()
    mocks.ghExecFileAsync.mockReset()
    mocks.resolveGithubAccountToken.mockReset()
    mocks.invoke.mockReset()
    mocks.invoke.mockImplementation(async (channel: string, args: unknown) => {
      const handler = harness.handlers[channel]
      if (!handler) {
        throw new Error(`No handler registered for '${channel}'`)
      }
      return handler({}, args)
    })
    registerGitHubHandlers(harness.store as never, harness.stats as never)
  })

  it('resolves the selected account through the preload API for project creation', async () => {
    mocks.resolveGithubAccountToken.mockResolvedValue('selected-account-token')
    mocks.ghExecFileAsync.mockResolvedValue({
      stdout: JSON.stringify({ id: 123, login: 'work', name: 'Work User', email: null })
    })

    await expect(
      ghMutationsAndProjectsApi.resolveAuthorIdentity({ accountRef: 'gh:github.com:work' })
    ).resolves.toEqual({ name: 'Work User', email: '123+work@users.noreply.github.com' })
    expect(mocks.ghExecFileAsync).toHaveBeenCalledWith(
      expect.arrayContaining(['--hostname', 'github.com', 'user']),
      expect.objectContaining({
        skipAccountEnv: true,
        env: expect.objectContaining({ GH_TOKEN: 'selected-account-token' })
      })
    )
  })

  it('does not fall back to another account when the selected account is unavailable', async () => {
    mocks.resolveGithubAccountToken.mockResolvedValue(null)

    await expect(
      ghMutationsAndProjectsApi.resolveAuthorIdentity({ accountRef: 'gh:github.com:missing' })
    ).resolves.toBeNull()
    expect(mocks.ghExecFileAsync).not.toHaveBeenCalled()
  })
})
