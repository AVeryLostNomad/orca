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
  cachedGithubAccountTokenForCwd,
  configureGithubAccountEnv,
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
