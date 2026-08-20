import { execFile, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { moveChangesBetweenWorktrees, type GitMoveChangesExec } from './git-move-changes'

const execFileAsync = promisify(execFile)
const tempRoots: string[] = []

const exec: GitMoveChangesExec = async (args, cwd) => {
  const { stdout, stderr } = await execFileAsync('git', args, { cwd, encoding: 'utf8' })
  return { stdout, stderr }
}

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

async function createRepoWithTwoWorktrees(): Promise<{ source: string; target: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'orca-move-changes-'))
  tempRoots.push(root)
  const source = path.join(root, 'source')
  execFileSync('git', ['init', '-q', '-b', 'main', source])
  git(source, ['config', 'user.email', 'test@example.com'])
  git(source, ['config', 'user.name', 'Test User'])
  git(source, ['config', 'commit.gpgSign', 'false'])
  await write(source, 'a.txt', 'base a\n')
  await write(source, 'b.txt', 'base b\n')
  git(source, ['add', '-A'])
  git(source, ['commit', '-q', '-m', 'base'])
  const target = path.join(root, 'target')
  git(source, ['worktree', 'add', '-q', '-b', 'other', target, 'main'])
  return { source, target }
}

async function write(repo: string, relativePath: string, contents: string): Promise<void> {
  const filePath = path.join(repo, relativePath)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, contents)
}

function statusPorcelain(repo: string): string {
  return git(repo, ['status', '--porcelain'])
}

function stashCount(repo: string): number {
  const list = git(repo, ['stash', 'list'])
  return list ? list.split('\n').length : 0
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('moveChangesBetweenWorktrees (real git)', () => {
  it('moves tracked, staged and untracked changes and leaves no stash behind', async () => {
    const { source, target } = await createRepoWithTwoWorktrees()
    await write(source, 'a.txt', 'edited a\n')
    await write(source, 'b.txt', 'edited b\n')
    git(source, ['add', 'b.txt'])
    await write(source, 'new/file.txt', 'brand new\n')

    const result = await moveChangesBetweenWorktrees(exec, source, target)

    expect(result).toEqual({ status: 'moved' })
    expect(statusPorcelain(source)).toBe('')
    const targetStatus = statusPorcelain(target)
    expect(targetStatus).toContain('a.txt')
    expect(targetStatus).toContain('b.txt')
    // Why: porcelain collapses an all-untracked directory to `?? new/`.
    expect(targetStatus).toContain('new/')
    expect(await readFile(path.join(target, 'a.txt'), 'utf8')).toBe('edited a\n')
    expect(await readFile(path.join(target, 'new/file.txt'), 'utf8')).toBe('brand new\n')
    expect(stashCount(source)).toBe(0)
  })

  it('reports nothing-to-move on a clean source', async () => {
    const { source, target } = await createRepoWithTwoWorktrees()
    const result = await moveChangesBetweenWorktrees(exec, source, target)
    expect(result).toEqual({ status: 'nothing-to-move' })
  })

  it('blocks and restores the source when an untracked file already exists in the target', async () => {
    const { source, target } = await createRepoWithTwoWorktrees()
    await write(source, 'collide.txt', 'from source\n')
    await write(target, 'collide.txt', 'already in target\n')

    const result = await moveChangesBetweenWorktrees(exec, source, target)

    expect(result.status).toBe('blocked')
    if (result.status === 'blocked') {
      expect(result.message).toContain('collide.txt')
    }
    // Source restored intact, target untouched, no leftover stash entry.
    expect(await readFile(path.join(source, 'collide.txt'), 'utf8')).toBe('from source\n')
    expect(await readFile(path.join(target, 'collide.txt'), 'utf8')).toBe('already in target\n')
    expect(stashCount(source)).toBe(0)
  })

  it('restores the staged/unstaged split when the move is blocked', async () => {
    const { source, target } = await createRepoWithTwoWorktrees()
    await write(source, 'a.txt', 'staged edit\n')
    git(source, ['add', 'a.txt'])
    await write(source, 'blocker.txt', 'x\n')
    await write(target, 'blocker.txt', 'y\n')

    const result = await moveChangesBetweenWorktrees(exec, source, target)

    expect(result.status).toBe('blocked')
    expect(statusPorcelain(source)).toContain('M  a.txt')
  })

  it('keeps a backup stash when the apply lands with conflicts in the target', async () => {
    const { source, target } = await createRepoWithTwoWorktrees()
    await write(source, 'a.txt', 'source edit\n')
    // Why: a *committed* divergence forces stash apply into a 3-way merge that
    // lands with conflict markers (an uncommitted target edit is refused upfront
    // and surfaces as 'blocked' instead).
    await write(target, 'a.txt', 'conflicting target edit\n')
    git(target, ['add', 'a.txt'])
    git(target, ['commit', '-q', '-m', 'diverge'])

    const result = await moveChangesBetweenWorktrees(exec, source, target)

    expect(result).toEqual({ status: 'conflicts' })
    expect(git(target, ['ls-files', '--unmerged'])).not.toBe('')
    // The source is clean (changes live in the target + stash backup).
    expect(statusPorcelain(source)).toBe('')
    expect(stashCount(source)).toBe(1)
  })

  it('blocks and restores when the target is not in the same repository', async () => {
    const { source } = await createRepoWithTwoWorktrees()
    const { target: foreignTarget } = await createRepoWithTwoWorktrees()
    await write(source, 'a.txt', 'edited\n')

    const result = await moveChangesBetweenWorktrees(exec, source, foreignTarget)

    expect(result.status).toBe('blocked')
    expect(await readFile(path.join(source, 'a.txt'), 'utf8')).toBe('edited\n')
    expect(stashCount(source)).toBe(0)
  })

  it('moves a deleted file as a deletion in the target', async () => {
    const { source, target } = await createRepoWithTwoWorktrees()
    await rm(path.join(source, 'b.txt'))

    const result = await moveChangesBetweenWorktrees(exec, source, target)

    expect(result).toEqual({ status: 'moved' })
    expect(statusPorcelain(source)).toBe('')
    expect(existsSync(path.join(target, 'b.txt'))).toBe(false)
  })
})
