import { execFile, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyGitStash,
  dropGitStash,
  listGitStashFiles,
  listGitStashes,
  parseGitNameStatusZ,
  parseGitStashList,
  parseGitStashSubject,
  pushGitStash,
  type GitStashExec
} from './git-stash'

const execFileAsync = promisify(execFile)
const tempRoots: string[] = []

const exec: GitStashExec = async (args, cwd) => {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8'
  })
  return { stdout, stderr }
}

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

async function write(repo: string, relativePath: string, contents: string): Promise<void> {
  const filePath = path.join(repo, relativePath)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, contents)
}

async function createRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'orca-stash-'))
  tempRoots.push(root)
  const repo = path.join(root, 'repo')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  git(repo, ['config', 'user.email', 'test@example.com'])
  git(repo, ['config', 'user.name', 'Test User'])
  git(repo, ['config', 'commit.gpgSign', 'false'])
  await write(repo, 'a.txt', 'base a\n')
  await write(repo, 'b.txt', 'base b\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-q', '-m', 'base'])
  return repo
}

function statusPorcelain(repo: string): string {
  // Why: not trimmed — the leading column of porcelain output is significant.
  return execFileSync('git', ['status', '--porcelain'], {
    cwd: repo,
    encoding: 'utf8'
  }).trimEnd()
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('git stash parsers', () => {
  it('splits git subjects into branch and message', () => {
    expect(parseGitStashSubject('On main: my work')).toEqual({
      branch: 'main',
      message: 'my work'
    })
    expect(parseGitStashSubject('WIP on feature/x: abc123 subject')).toEqual({
      branch: 'feature/x',
      message: 'abc123 subject'
    })
    expect(parseGitStashSubject('custom')).toEqual({
      branch: null,
      message: 'custom'
    })
  })

  it('parses the NUL-delimited stash list record', () => {
    const sha = 'a'.repeat(40)
    const stdout = `${sha}stash@{0}1700000000On main: hello\0`
    expect(parseGitStashList(stdout)).toEqual([
      {
        sha,
        selector: 'stash@{0}',
        index: 0,
        message: 'hello',
        branch: 'main',
        timestamp: 1_700_000_000_000
      }
    ])
  })

  it('parses name-status with renames', () => {
    expect(parseGitNameStatusZ('M\0a.txt\0R100\0old.txt\0new.txt\0A\0c.txt\0')).toEqual([
      { path: 'a.txt', status: 'modified' },
      { path: 'new.txt', status: 'renamed', oldPath: 'old.txt' },
      { path: 'c.txt', status: 'added' }
    ])
  })
})

describe('git stash (real git)', () => {
  it('lists nothing in a repo without stashes', async () => {
    const repo = await createRepo()
    expect(await listGitStashes(exec, repo)).toEqual({ stashes: [] })
  })

  it('stashes everything with a name, lists it with its files, applies and drops it', async () => {
    const repo = await createRepo()
    await write(repo, 'a.txt', 'edited a\n')
    await write(repo, 'b.txt', 'edited b\n')
    git(repo, ['add', 'b.txt'])
    await write(repo, 'new/file.txt', 'brand new\n')

    const pushed = await pushGitStash(exec, repo, {
      message: 'my work',
      scope: 'all'
    })
    expect(pushed.status).toBe('stashed')
    expect(statusPorcelain(repo)).toBe('')

    const { stashes } = await listGitStashes(exec, repo)
    expect(stashes).toHaveLength(1)
    expect(stashes[0]).toMatchObject({
      message: 'my work',
      branch: 'main',
      selector: 'stash@{0}'
    })
    expect(stashes[0].timestamp).toBeGreaterThan(0)

    const { entries } = await listGitStashFiles(exec, repo, stashes[0].sha)
    expect(entries.map((entry) => `${entry.status}:${entry.path}`)).toEqual([
      'modified:a.txt',
      'modified:b.txt',
      'added:new/file.txt'
    ])

    const applied = await applyGitStash(exec, repo, stashes[0].sha)
    expect(applied).toEqual({ status: 'applied' })
    expect(await readFile(path.join(repo, 'a.txt'), 'utf8')).toBe('edited a\n')
    expect(existsSync(path.join(repo, 'new/file.txt'))).toBe(true)
    // Why: --index restores the staged/unstaged split.
    expect(statusPorcelain(repo)).toContain('M  b.txt')
    // Why: apply keeps the entry; the user drops it explicitly.
    expect((await listGitStashes(exec, repo)).stashes).toHaveLength(1)

    const dropped = await dropGitStash(exec, repo, stashes[0].sha)
    expect(dropped).toEqual({ status: 'dropped' })
    expect((await listGitStashes(exec, repo)).stashes).toHaveLength(0)
    expect(await dropGitStash(exec, repo, stashes[0].sha)).toEqual({
      status: 'not-found'
    })
  })

  it('reports nothing-to-stash on a clean worktree', async () => {
    const repo = await createRepo()
    expect(await pushGitStash(exec, repo, { message: 'x', scope: 'all' })).toEqual({
      status: 'nothing-to-stash'
    })
    expect(
      await pushGitStash(exec, repo, {
        message: 'x',
        scope: 'staged',
        paths: []
      })
    ).toEqual({
      status: 'nothing-to-stash'
    })
  })

  it('stashes only the staged area and leaves other changes in place', async () => {
    const repo = await createRepo()
    await write(repo, 'a.txt', 'edited a\n')
    await write(repo, 'b.txt', 'edited b\n')
    git(repo, ['add', 'b.txt'])
    await write(repo, 'untracked.txt', 'loose\n')

    const pushed = await pushGitStash(exec, repo, {
      message: 'staged only',
      scope: 'staged',
      paths: ['b.txt']
    })
    expect(pushed.status).toBe('stashed')
    const status = statusPorcelain(repo)
    expect(status).toContain(' M a.txt')
    expect(status).toContain('?? untracked.txt')
    expect(status).not.toContain('b.txt')
  })

  it('stashes only untracked files and keeps tracked edits', async () => {
    const repo = await createRepo()
    await write(repo, 'a.txt', 'edited a\n')
    await write(repo, 'untracked.txt', 'loose\n')

    const pushed = await pushGitStash(exec, repo, {
      message: 'untracked only',
      scope: 'untracked',
      paths: ['untracked.txt']
    })
    expect(pushed.status).toBe('stashed')
    expect(statusPorcelain(repo)).toBe(' M a.txt')
    expect(existsSync(path.join(repo, 'untracked.txt'))).toBe(false)

    const { stashes } = await listGitStashes(exec, repo)
    const { entries } = await listGitStashFiles(exec, repo, stashes[0].sha)
    expect(entries).toEqual([{ path: 'untracked.txt', status: 'added' }])
  })

  it('stashes unstaged edits while keeping the index intact', async () => {
    const repo = await createRepo()
    await write(repo, 'a.txt', 'edited a\n')
    await write(repo, 'b.txt', 'edited b\n')
    git(repo, ['add', 'b.txt'])

    const pushed = await pushGitStash(exec, repo, {
      message: 'unstaged only',
      scope: 'unstaged',
      paths: ['a.txt']
    })
    expect(pushed.status).toBe('stashed')
    expect(statusPorcelain(repo)).toBe('M  b.txt')
  })

  it('reports conflicts when the stash no longer applies cleanly', async () => {
    const repo = await createRepo()
    await write(repo, 'a.txt', 'stashed a\n')
    const pushed = await pushGitStash(exec, repo, {
      message: 'conflicting',
      scope: 'all'
    })
    expect(pushed.status).toBe('stashed')
    await write(repo, 'a.txt', 'committed a\n')
    git(repo, ['commit', '-q', '-am', 'diverge'])

    const { stashes } = await listGitStashes(exec, repo)
    expect(await applyGitStash(exec, repo, stashes[0].sha)).toEqual({
      status: 'conflicts'
    })
    expect(statusPorcelain(repo)).toContain('UU a.txt')
    // Why: the entry survives as the backup for the conflicted apply.
    expect((await listGitStashes(exec, repo)).stashes).toHaveLength(1)
  })
})
