import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Repo } from '../../shared/repo-types'

const { loadGithubPatTokenMock } = vi.hoisted(() => ({
  loadGithubPatTokenMock: vi.fn()
}))
vi.mock('./github-pat-store', () => ({
  loadGithubPatToken: loadGithubPatTokenMock
}))

import {
  _resetGithubAccountEnv,
  cachedGithubAccountCommitIdentityForCwd,
  cachedGithubAccountTokenForCwd,
  configureGithubAccountEnv,
  githubAccountCommitIdentityForCwd,
  githubAccountGitCredentialForCwd,
  githubAccountRefForCwd,
  githubAccountTokenForCwd,
  invalidateGithubAccountToken,
  resolveGithubAccountToken
} from './github-account-env'

function repoWith(path: string, githubAccountRef?: string): Repo {
  return {
    id: path,
    path,
    displayName: 'r',
    badgeColor: '#fff',
    addedAt: 0,
    ...(githubAccountRef ? { githubAccountRef } : {})
  }
}

describe('github-account-env', () => {
  let dir: string
  const ghExec = vi.fn()

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gh-acct-'))
    ghExec.mockReset()
    loadGithubPatTokenMock.mockReset()
  })

  afterEach(() => {
    _resetGithubAccountEnv()
    rmSync(dir, { recursive: true, force: true })
  })

  function configure(repos: Repo[]): void {
    configureGithubAccountEnv({ getRepos: () => repos, ghExec })
  }

  it('matches the repo path and paths inside it, preferring the longest pin', () => {
    const outer = join(dir, 'work')
    const inner = join(dir, 'work', 'sub')
    configure([repoWith(outer, 'gh:github.com:work'), repoWith(inner, 'gh:github.com:inner')])
    expect(githubAccountRefForCwd(outer)).toBe('gh:github.com:work')
    expect(githubAccountRefForCwd(join(outer, 'deep', 'er'))).toBe('gh:github.com:work')
    expect(githubAccountRefForCwd(inner)).toBe('gh:github.com:inner')
    expect(githubAccountRefForCwd(join(dir, 'other'))).toBeNull()
    // Sibling prefix without a separator must not match.
    expect(githubAccountRefForCwd(`${outer}space`)).toBeNull()
  })

  it('follows a worktree .git pointer back to the pinned repo', () => {
    const repoPath = join(dir, 'repo')
    const worktree = join(dir, 'worktrees', 'feat-x')
    mkdirSync(worktree, { recursive: true })
    writeFileSync(join(worktree, '.git'), `gitdir: ${repoPath}/.git/worktrees/feat-x\n`)
    configure([repoWith(repoPath, 'gh:github.com:work')])
    expect(githubAccountRefForCwd(worktree)).toBe('gh:github.com:work')
  })

  it('resolves gh-cli tokens via gh auth token and caches them', async () => {
    configure([repoWith(join(dir, 'r'), 'gh:github.com:work')])
    ghExec.mockResolvedValue({ stdout: 'gho_tok\n', stderr: '' })
    await expect(resolveGithubAccountToken('gh:github.com:work')).resolves.toBe('gho_tok')
    await expect(resolveGithubAccountToken('gh:github.com:work')).resolves.toBe('gho_tok')
    expect(ghExec).toHaveBeenCalledTimes(1)
    expect(ghExec).toHaveBeenCalledWith(
      ['auth', 'token', '--hostname', 'github.com', '--user', 'work'],
      { skipAccountEnv: true }
    )
    invalidateGithubAccountToken('gh:github.com:work')
    await resolveGithubAccountToken('gh:github.com:work')
    expect(ghExec).toHaveBeenCalledTimes(2)
  })

  it('falls back to ambient auth when gh cannot produce the token', async () => {
    configure([repoWith(join(dir, 'r'), 'gh:github.com:gone')])
    ghExec.mockRejectedValue(new Error('no such user'))
    await expect(githubAccountTokenForCwd(join(dir, 'r'))).resolves.toBeNull()
  })

  it('resolves pat refs from the token store', async () => {
    const repoPath = join(dir, 'r')
    configure([repoWith(repoPath, 'pat:abc')])
    loadGithubPatTokenMock.mockReturnValue('ghp_secret')
    await expect(githubAccountTokenForCwd(repoPath)).resolves.toEqual({
      ref: 'pat:abc',
      token: 'ghp_secret'
    })
    // Sync PTY path serves from the now-warm cache.
    expect(cachedGithubAccountTokenForCwd(repoPath)).toBe('ghp_secret')
  })

  it('sync lookup returns null before warmup but kicks off resolution', async () => {
    const repoPath = join(dir, 'r')
    configure([repoWith(repoPath, 'gh:github.com:work')])
    let resolveExec: (v: { stdout: string; stderr: string }) => void = () => {}
    ghExec.mockImplementation(() => new Promise((res) => (resolveExec = res)))
    expect(cachedGithubAccountTokenForCwd(repoPath)).toBeNull()
    resolveExec({ stdout: 'tok', stderr: '' })
    await vi.waitFor(() => expect(cachedGithubAccountTokenForCwd(repoPath)).toBe('tok'))
  })
})

describe('githubAccountGitCredentialForCwd', () => {
  let dir: string
  const ghExec = vi.fn()

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gh-acct-git-'))
    ghExec.mockReset()
    loadGithubPatTokenMock.mockReset()
  })

  afterEach(() => {
    _resetGithubAccountEnv()
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns the gh account token with its ref host', async () => {
    const repoPath = join(dir, 'work')
    configureGithubAccountEnv({
      getRepos: () => [repoWith(repoPath, 'gh:ghe.example.com:me')],
      ghExec
    })
    ghExec.mockResolvedValue({ stdout: 'tok-gh\n', stderr: '' })

    expect(await githubAccountGitCredentialForCwd(repoPath)).toEqual({
      ref: 'gh:ghe.example.com:me',
      token: 'tok-gh',
      host: 'ghe.example.com'
    })
  })

  it('resolves a PAT host from account metadata, defaulting to github.com', async () => {
    const repoPath = join(dir, 'work')
    const otherPath = join(dir, 'other')
    configureGithubAccountEnv({
      getRepos: () => [repoWith(repoPath, 'pat:id-1'), repoWith(otherPath, 'pat:id-2')],
      ghExec,
      getPatAccounts: () => [{ id: 'id-1', label: 'work', host: 'ghe.example.com' }]
    })
    loadGithubPatTokenMock.mockReturnValue('tok-pat')

    expect(await githubAccountGitCredentialForCwd(repoPath)).toEqual({
      ref: 'pat:id-1',
      token: 'tok-pat',
      host: 'ghe.example.com'
    })
    expect(await githubAccountGitCredentialForCwd(otherPath)).toEqual({
      ref: 'pat:id-2',
      token: 'tok-pat',
      host: 'github.com'
    })
  })

  it('returns null for unpinned paths', async () => {
    configureGithubAccountEnv({ getRepos: () => [], ghExec })
    expect(await githubAccountGitCredentialForCwd(join(dir, 'x'))).toBeNull()
  })
})

describe('githubAccountCommitIdentityForCwd', () => {
  let dir: string
  const ghExec = vi.fn()

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gh-acct-id-'))
    ghExec.mockReset()
    loadGithubPatTokenMock.mockReset()
  })

  afterEach(() => {
    _resetGithubAccountEnv()
    rmSync(dir, { recursive: true, force: true })
  })

  function configureGhAccount(repoPath: string, user: Record<string, unknown>): void {
    configureGithubAccountEnv({
      getRepos: () => [repoWith(repoPath, 'gh:github.com:me')],
      ghExec
    })
    ghExec.mockImplementation(async (args: string[], options: { env?: NodeJS.ProcessEnv }) => {
      if (args[0] === 'auth') {
        return { stdout: 'tok-1\n', stderr: '' }
      }
      expect(args).toEqual(['api', '--hostname', 'github.com', 'user'])
      expect(options.env?.GH_TOKEN).toBe('tok-1')
      return { stdout: JSON.stringify(user), stderr: '' }
    })
  }

  it('uses the profile name and public email when present', async () => {
    const repoPath = join(dir, 'work')
    configureGhAccount(repoPath, {
      login: 'me',
      id: 42,
      name: 'Me Myself',
      email: 'me@example.com'
    })

    expect(await githubAccountCommitIdentityForCwd(repoPath)).toEqual({
      name: 'Me Myself',
      email: 'me@example.com'
    })
  })

  it('falls back to login and the id+login noreply email', async () => {
    const repoPath = join(dir, 'work')
    configureGhAccount(repoPath, { login: 'me', id: 42, name: null, email: null })

    expect(await githubAccountCommitIdentityForCwd(repoPath)).toEqual({
      name: 'me',
      email: '42+me@users.noreply.github.com'
    })
  })

  it('caches the identity per account ref', async () => {
    const repoPath = join(dir, 'work')
    configureGhAccount(repoPath, { login: 'me', id: 42 })

    await githubAccountCommitIdentityForCwd(repoPath)
    await githubAccountCommitIdentityForCwd(repoPath)

    expect(ghExec.mock.calls.filter(([args]) => args[0] === 'api')).toHaveLength(1)
  })

  it('serves the sync PTY path only after resolution and clears on invalidation', async () => {
    const repoPath = join(dir, 'work')
    configureGhAccount(repoPath, { login: 'me', id: 42 })

    expect(cachedGithubAccountCommitIdentityForCwd(repoPath)).toBeNull()
    await githubAccountCommitIdentityForCwd(repoPath)
    expect(cachedGithubAccountCommitIdentityForCwd(repoPath)).toEqual({
      name: 'me',
      email: '42+me@users.noreply.github.com'
    })

    invalidateGithubAccountToken('gh:github.com:me')
    expect(cachedGithubAccountCommitIdentityForCwd(repoPath)).toBeNull()
  })

  it('returns null when the identity lookup fails', async () => {
    const repoPath = join(dir, 'work')
    configureGithubAccountEnv({
      getRepos: () => [repoWith(repoPath, 'gh:github.com:me')],
      ghExec
    })
    ghExec.mockImplementation(async (args: string[]) => {
      if (args[0] === 'auth') {
        return { stdout: 'tok-1\n', stderr: '' }
      }
      throw new Error('gh missing')
    })

    expect(await githubAccountCommitIdentityForCwd(repoPath)).toBeNull()
  })
})
