// Real Git verifies merge/rebase landing and that every failure leaves both refs untouched.
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installRealWorkerThreadChildProcesses } from '../worker-thread-child-process/worker-thread-child-process-real.test-fixtures'
import { removeTree } from '../../shared/windows-transient-lock-removal'
import { mergeWorktreeIntoTarget } from './worktree-merge-into-target'

const execFileAsync = promisify(execFile)

installRealWorkerThreadChildProcesses()

let scratchDir = ''
let repoPath = ''
let featurePath = ''

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout.trim()
}

async function commitFile(cwd: string, file: string, content: string, message: string) {
  await writeFile(join(cwd, file), content)
  await git(['add', '-A'], cwd)
  await git(['commit', '-qm', message], cwd)
}

const sha = (ref: string) => git(['rev-parse', ref], repoPath)

beforeEach(async () => {
  scratchDir = await realpath(await mkdtemp(join(tmpdir(), 'orca-worktree-merge-')))
  repoPath = join(scratchDir, 'repo')
  featurePath = join(scratchDir, 'feature')
  await mkdir(repoPath, { recursive: true })
  await git(['init', '-q', '-b', 'main'], repoPath)
  await git(['config', 'user.email', 'merge@example.invalid'], repoPath)
  await git(['config', 'user.name', 'Worktree Merge'], repoPath)
  await git(['config', 'maintenance.auto', 'false'], repoPath)
  await git(['config', 'gc.auto', '0'], repoPath)
  await commitFile(repoPath, 'seed.txt', 'seed\n', 'seed')
  await git(['branch', 'stable'], repoPath)
  await git(['worktree', 'add', '-q', featurePath, '-b', 'feature', 'stable'], repoPath)
})

afterEach(async () => {
  await removeTree(scratchDir)
})

describe('mergeWorktreeIntoTarget against the real Git binary', () => {
  it('fast-forwards a target that is checked out in another worktree', async () => {
    await commitFile(featurePath, 'a.txt', 'a\n', 'feature work')
    const stablePath = join(scratchDir, 'stable')
    await git(['worktree', 'add', '-q', stablePath, 'stable'], repoPath)

    const result = await mergeWorktreeIntoTarget({
      sourceWorktreePath: featurePath,
      targetRef: 'stable',
      mode: 'merge'
    })

    expect(result).toMatchObject({ sourceBranch: 'feature', targetBranch: 'stable' })
    expect(await sha('stable')).toBe(await sha('feature'))
    expect(await git(['status', '--porcelain'], stablePath)).toBe('')
  })

  it('creates a merge commit on a target with no checkout', async () => {
    await commitFile(featurePath, 'a.txt', 'a\n', 'feature work')
    await git(['checkout', '-q', 'stable'], repoPath)
    await commitFile(repoPath, 'b.txt', 'b\n', 'stable work')
    await git(['checkout', '-q', 'main'], repoPath)
    const stableBefore = await sha('stable')

    await mergeWorktreeIntoTarget({
      sourceWorktreePath: featurePath,
      targetRef: 'stable',
      mode: 'merge'
    })

    const parents = (await git(['rev-list', '--parents', '-n', '1', 'stable'], repoPath)).split(' ')
    expect(parents.slice(1)).toEqual([stableBefore, await sha('feature')])
    expect(await git(['show', 'stable:a.txt'], repoPath)).toBe('a')
    expect(await git(['show', 'stable:b.txt'], repoPath)).toBe('b')
  })

  it('refuses a conflicting merge and leaves both refs unchanged', async () => {
    await commitFile(featurePath, 'seed.txt', 'feature\n', 'feature edit')
    await git(['checkout', '-q', 'stable'], repoPath)
    await commitFile(repoPath, 'seed.txt', 'stable\n', 'stable edit')
    await git(['checkout', '-q', 'main'], repoPath)
    const [stableBefore, featureBefore] = [await sha('stable'), await sha('feature')]

    await expect(
      mergeWorktreeIntoTarget({
        sourceWorktreePath: featurePath,
        targetRef: 'stable',
        mode: 'merge'
      })
    ).rejects.toThrow(/conflicts/)

    expect(await sha('stable')).toBe(stableBefore)
    expect(await sha('feature')).toBe(featureBefore)
  })

  it('aborts a conflicting rebase and leaves both refs unchanged', async () => {
    await commitFile(featurePath, 'seed.txt', 'feature\n', 'feature edit')
    await git(['checkout', '-q', 'stable'], repoPath)
    await commitFile(repoPath, 'seed.txt', 'stable\n', 'stable edit')
    await git(['checkout', '-q', 'main'], repoPath)
    const [stableBefore, featureBefore] = [await sha('stable'), await sha('feature')]

    await expect(
      mergeWorktreeIntoTarget({
        sourceWorktreePath: featurePath,
        targetRef: 'stable',
        mode: 'rebase'
      })
    ).rejects.toThrow(/aborted/)

    expect(await sha('stable')).toBe(stableBefore)
    expect(await sha('feature')).toBe(featureBefore)
    expect(await git(['status', '--porcelain'], featurePath)).toBe('')
  })

  it('rebases onto the target and fast-forwards it to a linear history', async () => {
    await commitFile(featurePath, 'a.txt', 'a\n', 'feature work')
    await git(['checkout', '-q', 'stable'], repoPath)
    await commitFile(repoPath, 'b.txt', 'b\n', 'stable work')
    await git(['checkout', '-q', 'main'], repoPath)

    await mergeWorktreeIntoTarget({
      sourceWorktreePath: featurePath,
      targetRef: 'stable',
      mode: 'rebase'
    })

    expect(await sha('stable')).toBe(await sha('feature'))
    expect(await git(['rev-list', '--merges', '--count', 'stable'], repoPath)).toBe('0')
  })

  it('refuses a worktree with uncommitted changes', async () => {
    await writeFile(join(featurePath, 'dirty.txt'), 'dirty\n')
    const stableBefore = await sha('stable')

    await expect(
      mergeWorktreeIntoTarget({
        sourceWorktreePath: featurePath,
        targetRef: 'stable',
        mode: 'merge'
      })
    ).rejects.toThrow(/uncommitted/)
    expect(await sha('stable')).toBe(stableBefore)
  })

  it('lands a remote ref on a newly created local branch', async () => {
    await commitFile(featurePath, 'a.txt', 'a\n', 'feature work')
    await git(['update-ref', 'refs/remotes/origin/release', await sha('stable')], repoPath)

    const result = await mergeWorktreeIntoTarget({
      sourceWorktreePath: featurePath,
      targetRef: 'origin/release',
      mode: 'merge'
    })

    expect(result.targetBranch).toBe('release')
    expect(await sha('release')).toBe(await sha('feature'))
    expect(await sha('origin/release')).toBe(await sha('stable'))
  })
})
