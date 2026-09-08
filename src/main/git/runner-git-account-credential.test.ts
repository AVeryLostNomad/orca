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

import { ghExecFileAsync } from './command-runner/gh-exec-file'
import {
  gitCommitIdentitySubcommand,
  gitNetworkSubcommand,
  setGhAccountEnvResolver,
  setGitAccountCredentialResolver,
  setGitAccountIdentityResolver
} from './command-runner/github-account-env'
import { gitExecFileAsync } from './command-runner/git-exec-file'
import { gitSpawnAfterWindowsEnvironmentReady } from './command-runner/git-spawn'
import { gitStreamStdout } from './command-runner/git-stream-stdout'
import { _resetGitAdmissionForTests } from './command-runner/git-subprocess-admission'

function createMockChild(): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter } {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

function environmentWithoutGitIdentity(): NodeJS.ProcessEnv {
  const {
    GIT_AUTHOR_NAME: _authorName,
    GIT_AUTHOR_EMAIL: _authorEmail,
    GIT_COMMITTER_NAME: _committerName,
    GIT_COMMITTER_EMAIL: _committerEmail,
    ...env
  } = process.env
  return env
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
    _resetGitAdmissionForTests()
    setGitAccountCredentialResolver(null)
    vi.restoreAllMocks()
  })

  function mockExecResult(error: Error | null = null): { env: () => NodeJS.ProcessEnv } {
    let capturedEnv: NodeJS.ProcessEnv = {}
    execFileMock.mockImplementation((_cmd, _args, options, callback) => {
      capturedEnv = options.env
      const child = createMockChild()
      callback(error, '', '')
      queueMicrotask(() => child.emit('close', error ? 1 : 0))
      return child
    })
    return { env: () => capturedEnv }
  }

  it('injects the pinned credential helper for network subcommands', async () => {
    resolver.mockResolvedValue({ ref: 'gh:github.com:me', token: 'tok-1', host: 'github.com' })
    const captured = mockExecResult()

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
    const captured = mockExecResult()

    await gitExecFileAsync(['status', '--porcelain'], { cwd: '/repo' })

    expect(resolver).not.toHaveBeenCalled()
    expect(captured.env().ORCA_PINNED_GH_TOKEN).toBeUndefined()
  })

  it('leaves the env untouched for unpinned repos', async () => {
    resolver.mockResolvedValue(null)
    const captured = mockExecResult()

    await gitExecFileAsync(['push', 'origin', 'HEAD'], { cwd: '/repo' })

    expect(captured.env().ORCA_PINNED_GH_TOKEN).toBeUndefined()
    expect(
      readGitConfigEnvEntries(captured.env()).some(([key]) => key.startsWith('credential.https://'))
    ).toBe(false)
  })

  it('invalidates the cached token when the push fails authentication', async () => {
    resolver.mockResolvedValue({ ref: 'pat:id-1', token: 'tok-stale', host: 'github.com' })
    mockExecResult(new Error('fatal: Authentication failed for https://github.com/me/repo.git/'))

    await expect(gitExecFileAsync(['push', 'origin', 'HEAD'], { cwd: '/repo' })).rejects.toThrow(
      'Authentication failed'
    )
    expect(invalidator).toHaveBeenCalledWith('pat:id-1')
  })

  it('does not invalidate on non-auth failures', async () => {
    resolver.mockResolvedValue({ ref: 'pat:id-1', token: 'tok-1', host: 'github.com' })
    mockExecResult(new Error('fatal: Could not resolve host: github.com'))

    await expect(gitExecFileAsync(['pull'], { cwd: '/repo' })).rejects.toThrow('resolve host')
    expect(invalidator).not.toHaveBeenCalled()
  })
})

describe('gh account injection', () => {
  const resolver = vi.fn()
  const invalidator = vi.fn()

  beforeEach(() => {
    spawnMock.mockReset()
    resolver.mockReset()
    invalidator.mockReset()
    setGhAccountEnvResolver(resolver, invalidator)
  })

  afterEach(() => {
    setGhAccountEnvResolver(null)
    vi.restoreAllMocks()
  })

  it('injects the selected account into the real gh executor without overriding explicit tokens', async () => {
    resolver.mockResolvedValue({ ref: 'gh:github.com:work', token: 'selected-token' })
    let capturedEnv: NodeJS.ProcessEnv = {}
    spawnMock.mockImplementation((_cmd, _args, options) => {
      capturedEnv = options.env
      const child = createMockChild()
      queueMicrotask(() => child.emit('close', 0))
      return child
    })

    await ghExecFileAsync(['repo', 'view'], { cwd: '/repo' })
    expect(capturedEnv.GH_TOKEN).toBe('selected-token')

    await ghExecFileAsync(['repo', 'view'], {
      cwd: '/repo',
      env: { GH_TOKEN: 'explicit-token' }
    })
    expect(capturedEnv.GH_TOKEN).toBe('explicit-token')
  })
})

describe('streamed and spawned Git account injection', () => {
  const resolver = vi.fn()

  beforeEach(() => {
    spawnMock.mockReset()
    resolver.mockReset()
    setGitAccountCredentialResolver(resolver)
  })

  afterEach(() => {
    _resetGitAdmissionForTests()
    setGitAccountCredentialResolver(null)
    vi.restoreAllMocks()
  })

  it('injects the selected credential into clone spawning and streamed network Git', async () => {
    resolver.mockResolvedValue({ ref: 'pat:work', token: 'selected-token', host: 'github.com' })
    const cloneChild = createMockChild()
    spawnMock.mockReturnValueOnce(cloneChild)
    await gitSpawnAfterWindowsEnvironmentReady(['clone', 'https://github.com/o/r.git'], {
      cwd: '/repo',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    expect(spawnMock.mock.calls[0]?.[2]?.env?.ORCA_PINNED_GH_TOKEN).toBe('selected-token')
    cloneChild.emit('close', 0)

    const streamChild = createMockChild()
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => streamChild.emit('close', 0))
      return streamChild
    })
    await gitStreamStdout(['ls-remote', 'origin'], {
      cwd: '/repo',
      onStdout: () => {}
    })
    expect(spawnMock.mock.calls[1]?.[2]?.env?.ORCA_PINNED_GH_TOKEN).toBe('selected-token')
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
    _resetGitAdmissionForTests()
    setGitAccountIdentityResolver(null)
    vi.restoreAllMocks()
  })

  function mockExecSuccess(): { env: () => NodeJS.ProcessEnv } {
    let capturedEnv: NodeJS.ProcessEnv = {}
    execFileMock.mockImplementation((_cmd, _args, opts, callback) => {
      capturedEnv = opts.env
      const child = createMockChild()
      callback(null, '', '')
      queueMicrotask(() => child.emit('close', 0))
      return child
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

    await gitExecFileAsync(['status', '--porcelain'], {
      cwd: '/repo',
      env: environmentWithoutGitIdentity()
    })

    expect(identityResolver).not.toHaveBeenCalled()
    expect(captured.env().GIT_AUTHOR_NAME).toBeUndefined()
  })

  it('caller-provided identity env wins over the pin', async () => {
    const captured = mockExecSuccess()

    await gitExecFileAsync(['commit', '-m', 'msg'], {
      cwd: '/repo',
      env: { ...environmentWithoutGitIdentity(), GIT_AUTHOR_EMAIL: 'explicit@example.com' }
    })

    expect(identityResolver).not.toHaveBeenCalled()
    expect(captured.env().GIT_AUTHOR_EMAIL).toBe('explicit@example.com')
  })

  it('leaves identity env untouched for unpinned repos', async () => {
    identityResolver.mockResolvedValue(null)
    const captured = mockExecSuccess()

    await gitExecFileAsync(['commit', '-m', 'msg'], {
      cwd: '/repo',
      env: environmentWithoutGitIdentity()
    })

    expect(captured.env().GIT_AUTHOR_NAME).toBeUndefined()
    expect(captured.env().GIT_COMMITTER_EMAIL).toBeUndefined()
  })
})
