// Real Git + real Windows locks: the rename-first removal must refuse up front, deleting nothing.
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installRealWorkerThreadChildProcesses } from '../worker-thread-child-process/worker-thread-child-process-real.test-fixtures'
import { removeTree } from '../../shared/windows-transient-lock-removal'
import { assertUnregisteredCheckoutGone } from '../worktree-removal-leftover'
import { listWorktreesStrict, removeWorktree } from './worktree'
import { areWorktreePathsEqual } from './worktree-path-comparison'
import { waitForPendingTrashDeletes } from './worktree-trash-removal'

const execFileAsync = promisify(execFile)

installRealWorkerThreadChildProcesses()

let scratchDir = ''
let repoPath = ''
let worktreePath = ''
let holder: ChildProcess | null = null

async function git(args: string[], cwd: string): Promise<string> {
  return (await execFileAsync('git', args, { cwd })).stdout
}

const isRegistered = async (path: string) =>
  (await listWorktreesStrict(repoPath)).some((w) => areWorktreePathsEqual(w.path, path))

beforeEach(async () => {
  scratchDir = await realpath(await mkdtemp(join(tmpdir(), 'orca-worktree-trash-')))
  repoPath = join(scratchDir, 'repo')
  worktreePath = join(scratchDir, 'workspaces', 'feature')
  await mkdir(repoPath, { recursive: true })
  await git(['init', '-q'], repoPath)
  await git(['config', 'user.email', 'trash@example.invalid'], repoPath)
  await git(['config', 'user.name', 'Worktree Trash'], repoPath)
  await git(['config', 'gc.auto', '0'], repoPath)
  await writeFile(join(repoPath, 'seed.txt'), 'seed\n')
  await git(['add', '-A'], repoPath)
  await git(['commit', '-qm', 'seed'], repoPath)
  await git(['worktree', 'add', '-q', worktreePath, '-b', 'feature'], repoPath)
})

afterEach(async () => {
  holder?.kill()
  holder = null
  await waitForPendingTrashDeletes()
  await removeTree(scratchDir)
})

describe.skipIf(process.platform !== 'win32')('rename-first worktree removal on Windows', () => {
  it('returns before the files are gone, then finishes the delete in the background', async () => {
    await mkdir(join(worktreePath, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(worktreePath, 'node_modules', 'pkg', 'index.js'), 'x\n')
    await git(['add', '-A'], worktreePath)
    await git(['commit', '-qm', 'deps'], worktreePath)

    await removeWorktree(repoPath, worktreePath, false, { deleteBranch: false })

    expect(existsSync(worktreePath)).toBe(false)
    expect(await isRegistered(worktreePath)).toBe(false)
    await waitForPendingTrashDeletes()
    expect(existsSync(join(scratchDir, 'workspaces', '.orca-worktree-trash'))).toBe(false)
  })

  it('refuses at once, deleting nothing, while a process has its cwd inside the checkout', async () => {
    holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: worktreePath,
      stdio: 'ignore'
    })
    await new Promise((r) => setTimeout(r, 300))

    await expect(
      removeWorktree(repoPath, worktreePath, false, { deleteBranch: false })
    ).rejects.toThrow(/open in another program[\s\S]*Nothing was deleted/)

    expect(existsSync(join(worktreePath, 'seed.txt'))).toBe(true)
    expect(await isRegistered(worktreePath)).toBe(true)
  })

  it('finishes an empty folder Git left after unregistering, but keeps one with files', async () => {
    const leftover = join(scratchDir, 'workspaces', 'leftover')
    await mkdir(leftover, { recursive: true })
    await assertUnregisteredCheckoutGone(leftover)
    expect(existsSync(leftover)).toBe(false)

    await mkdir(leftover, { recursive: true })
    await writeFile(join(leftover, 'keep.txt'), 'mine\n')
    await expect(assertUnregisteredCheckoutGone(leftover)).rejects.toThrow(
      /no longer a Git worktree/
    )
    expect(existsSync(join(leftover, 'keep.txt'))).toBe(true)
  })
})
