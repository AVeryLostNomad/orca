import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileMock, execFileSyncMock, spawnMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  execFileSyncMock: vi.fn(),
  spawnMock: vi.fn()
}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
  execFileSync: execFileSyncMock,
  spawn: spawnMock
}))

import {
  gitCommitIdentitySubcommand,
  gitExecFileAsync,
  gitNetworkSubcommand,
  setGitAccountCredentialResolver,
  setGitAccountIdentityResolver
} from './runner'

function createMockChild(): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter } {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

// Reads git config injected via the GIT_CONFIG_COUNT/KEY/VALUE env protocol
// back into ordered [key, value] pairs so tests can assert helper ordering.
function readGitConfigEnvEntries(env: NodeJS.ProcessEnv): [string, string][] {
  const count = Number.parseInt(env.GIT_CONFIG_COUNT ?? '0', 10)
  const entries: [string, string][] = []
  for (let i = 0; i < count; i++) {
    entries.push([env[`GIT_CONFIG_KEY_${i}`] ?? '', env[`GIT_CONFIG_VALUE_${i}`] ?? ''])
  }
  return entries
}

describe('gitNetworkSubcommand', () => {
  it('identifies remote-touching subcommands, skipping global options', () => {
    expect(gitNetworkSubcommand(['push', 'origin', 'HEAD'])).toBe('push')
    expect(gitNetworkSubcommand(['pull'])).toBe('pull')
    expect(gitNetworkSubcommand(['-c', 'maintenance.auto=false', 'fetch', 'origin'])).toBe('fetch')
    expect(gitNetworkSubcommand(['ls-remote', '--heads', 'origin'])).toBe('ls-remote')
    expect(gitNetworkSubcommand(['clone', 'url'])).toBe('clone')
  })

  it('returns null for local subcommands', () => {
    expect(gitNetworkSubcommand(['status', '--porcelain'])).toBeNull()
    expect(gitNetworkSubcommand(['config', '--get', 'remote.pushDefault'])).toBeNull()
    expect(gitNetworkSubcommand(['-c', 'x=y', 'commit', '-m', 'fetch'])).toBeNull()
    expect(gitNetworkSubcommand([])).toBeNull()
  })
})

describe('git account credential injection', () => {
  const resolver = vi.fn()
  const invalidator = vi.fn()

  beforeEach(() => {
    execFileMock.mockReset()
    resolver.mockReset()
    invalidator.mockReset()
    setGitAccountCredentialResolver(resolver, invalidator)
  })

  afterEach(() => {
    setGitAccountCredentialResolver(null)
    vi.restoreAllMocks()
  })

  function mockExecSuccess(): { env: () => NodeJS.ProcessEnv } {
    let capturedEnv: NodeJS.ProcessEnv = {}
    execFileMock.mockImplementation((_cmd, _args, opts, callback) => {
      capturedEnv = opts.env
      callback(null, '', '')
      return createMockChild()
    })
    return { env: () => capturedEnv }
  }

  it('injects the pinned credential helper for network subcommands', async () => {
    resolver.mockResolvedValue({ ref: 'gh:github.com:me', token: 'tok-1', host: 'github.com' })
    const captured = mockExecSuccess()

    await gitExecFileAsync(['fetch', 'origin'], { cwd: '/repo' })

    expect(resolver).toHaveBeenCalledWith('/repo')
    const env = captured.env()
    expect(env.ORCA_PINNED_GH_TOKEN).toBe('tok-1')
    const helperEntries = readGitConfigEnvEntries(env).filter(
      ([key]) => key === 'credential.https://github.com.helper'
    )
    expect(helperEntries[0]?.[1]).toBe('')
    expect(helperEntries[1]?.[1]).toContain('$ORCA_PINNED_GH_TOKEN')
  })

  it('does not consult the resolver for local subcommands', async () => {
    const captured = mockExecSuccess()

    await gitExecFileAsync(['status', '--porcelain'], { cwd: '/repo' })

    expect(resolver).not.toHaveBeenCalled()
    expect(captured.env().ORCA_PINNED_GH_TOKEN).toBeUndefined()
  })

  it('leaves the env untouched for unpinned repos', async () => {
    resolver.mockResolvedValue(null)
    const captured = mockExecSuccess()

    await gitExecFileAsync(['push', 'origin', 'HEAD'], { cwd: '/repo' })

    expect(captured.env().ORCA_PINNED_GH_TOKEN).toBeUndefined()
    expect(
      readGitConfigEnvEntries(captured.env()).some(([key]) => key.startsWith('credential.https://'))
    ).toBe(false)
  })

  it('invalidates the cached token when the push fails authentication', async () => {
    resolver.mockResolvedValue({ ref: 'pat:id-1', token: 'tok-stale', host: 'github.com' })
    execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(
        new Error('fatal: Authentication failed for https://github.com/me/repo.git/'),
        '',
        ''
      )
      return createMockChild()
    })

    await expect(gitExecFileAsync(['push', 'origin', 'HEAD'], { cwd: '/repo' })).rejects.toThrow(
      'Authentication failed'
    )
    expect(invalidator).toHaveBeenCalledWith('pat:id-1')
  })

  it('does not invalidate on non-auth failures', async () => {
    resolver.mockResolvedValue({ ref: 'pat:id-1', token: 'tok-1', host: 'github.com' })
    execFileMock.mockImplementation((_cmd, _args, _opts, callback) => {
      callback(new Error('fatal: Could not resolve host: github.com'), '', '')
      return createMockChild()
    })

    await expect(gitExecFileAsync(['pull'], { cwd: '/repo' })).rejects.toThrow('resolve host')
    expect(invalidator).not.toHaveBeenCalled()
  })
})

describe('gitCommitIdentitySubcommand', () => {
  it('identifies commit-creating subcommands', () => {
    expect(gitCommitIdentitySubcommand(['commit', '-m', 'x'])).toBe('commit')
    expect(gitCommitIdentitySubcommand(['-c', 'x=y', 'rebase', '--continue'])).toBe('rebase')
    expect(gitCommitIdentitySubcommand(['merge', '--no-ff', 'main'])).toBe('merge')
    expect(gitCommitIdentitySubcommand(['pull'])).toBe('pull')
    expect(gitCommitIdentitySubcommand(['stash', 'push'])).toBe('stash')
  })

  it('returns null for non-committing subcommands', () => {
    expect(gitCommitIdentitySubcommand(['status'])).toBeNull()
    expect(gitCommitIdentitySubcommand(['push', 'origin', 'HEAD'])).toBeNull()
    expect(gitCommitIdentitySubcommand(['ls-remote'])).toBeNull()
  })
})

describe('git account commit identity injection', () => {
  const identityResolver = vi.fn()

  beforeEach(() => {
    execFileMock.mockReset()
    identityResolver.mockReset()
    setGitAccountIdentityResolver(identityResolver)
  })

  afterEach(() => {
    setGitAccountIdentityResolver(null)
    vi.restoreAllMocks()
  })

  function mockExecSuccess(): { env: () => NodeJS.ProcessEnv } {
    let capturedEnv: NodeJS.ProcessEnv = {}
    execFileMock.mockImplementation((_cmd, _args, opts, callback) => {
      capturedEnv = opts.env
      callback(null, '', '')
      return createMockChild()
    })
    return { env: () => capturedEnv }
  }

  it('injects author and committer env for commits in pinned repos', async () => {
    identityResolver.mockResolvedValue({
      name: 'Me Myself',
      email: '42+me@users.noreply.github.com'
    })
    const captured = mockExecSuccess()

    await gitExecFileAsync(['commit', '-m', 'msg'], { cwd: '/repo' })

    expect(identityResolver).toHaveBeenCalledWith('/repo')
    const env = captured.env()
    expect(env.GIT_AUTHOR_NAME).toBe('Me Myself')
    expect(env.GIT_AUTHOR_EMAIL).toBe('42+me@users.noreply.github.com')
    expect(env.GIT_COMMITTER_NAME).toBe('Me Myself')
    expect(env.GIT_COMMITTER_EMAIL).toBe('42+me@users.noreply.github.com')
  })

  it('does not consult the resolver for non-committing subcommands', async () => {
    const captured = mockExecSuccess()

    await gitExecFileAsync(['status', '--porcelain'], { cwd: '/repo' })

    expect(identityResolver).not.toHaveBeenCalled()
    expect(captured.env().GIT_AUTHOR_NAME).toBeUndefined()
  })

  it('caller-provided identity env wins over the pin', async () => {
    const captured = mockExecSuccess()

    await gitExecFileAsync(['commit', '-m', 'msg'], {
      cwd: '/repo',
      env: { ...process.env, GIT_AUTHOR_EMAIL: 'explicit@example.com' }
    })

    expect(identityResolver).not.toHaveBeenCalled()
    expect(captured.env().GIT_AUTHOR_EMAIL).toBe('explicit@example.com')
  })

  it('leaves identity env untouched for unpinned repos', async () => {
    identityResolver.mockResolvedValue(null)
    const captured = mockExecSuccess()

    await gitExecFileAsync(['commit', '-m', 'msg'], { cwd: '/repo' })

    expect(captured.env().GIT_AUTHOR_NAME).toBeUndefined()
    expect(captured.env().GIT_COMMITTER_EMAIL).toBeUndefined()
  })
})
