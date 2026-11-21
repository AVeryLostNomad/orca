import { runWithGitWorktreeOperationLock } from '../../shared/git-worktree-operation-lock'
import type { GitRuntimeOptions } from './git-runtime-options'
import { gitOptionsForWorktree } from './git-runtime-options'
import { gitExecFileAsync } from './runner'
import { runWithGitReadCacheInvalidation } from './status'
import { detectConflictOperation } from './source-control/git-conflict-operation'
import { listWorktreesStrict } from './worktree-listing'
import { areWorktreePathsEqual } from './worktree-path-comparison'
import type {
  WorktreeMergeIntoTargetResult,
  WorktreeMergeMode
} from '../../shared/worktree-merge-types'

type ExecOptions = ReturnType<typeof gitOptionsForWorktree>

const HEADS_PREFIX = 'refs/heads/'
const REMOTES_PREFIX = 'refs/remotes/'

/** Land a linked worktree's branch on a local target branch, leaving both refs untouched on any failure. */
export async function mergeWorktreeIntoTarget(
  args: { sourceWorktreePath: string; targetRef: string; mode: WorktreeMergeMode },
  options: GitRuntimeOptions = {}
): Promise<WorktreeMergeIntoTargetResult> {
  return runWithGitWorktreeOperationLock(args.sourceWorktreePath, options.signal, () =>
    runWithGitReadCacheInvalidation(() => mergeUnlocked(args, options))
  )
}

async function mergeUnlocked(
  args: { sourceWorktreePath: string; targetRef: string; mode: WorktreeMergeMode },
  options: GitRuntimeOptions
): Promise<WorktreeMergeIntoTargetResult> {
  const sourceExec = gitOptionsForWorktree(args.sourceWorktreePath, options)
  const worktrees = await listWorktreesStrict(
    args.sourceWorktreePath,
    options.wslDistro ? { wslDistro: options.wslDistro } : {}
  )
  const source = worktrees.find((w) => areWorktreePathsEqual(w.path, args.sourceWorktreePath))
  if (!source?.branch.startsWith(HEADS_PREFIX)) {
    throw new Error('This worktree is not on a branch, so there is nothing to merge.')
  }
  const sourceBranch = source.branch.slice(HEADS_PREFIX.length)

  await assertReadyForMerge(args.sourceWorktreePath, sourceExec, 'This worktree')

  const targetBranch = await resolveLocalTargetBranch(args.targetRef, sourceExec)
  if (targetBranch === sourceBranch) {
    throw new Error(`Cannot merge ${sourceBranch} into itself.`)
  }

  if (args.mode === 'rebase') {
    try {
      await git(['rebase', `${HEADS_PREFIX}${targetBranch}`], sourceExec)
    } catch (error) {
      await git(['rebase', '--abort'], sourceExec).catch(() => undefined)
      throw new Error(`Rebase onto ${targetBranch} failed and was aborted. ${describe(error)}`)
    }
  }

  const sourceSha = await revParse(`${HEADS_PREFIX}${sourceBranch}`, sourceExec)
  const targetWorktree = worktrees.find((w) => w.branch === `${HEADS_PREFIX}${targetBranch}`)

  if (targetWorktree) {
    const targetExec = gitOptionsForWorktree(targetWorktree.path, options)
    await runWithGitWorktreeOperationLock(targetWorktree.path, options.signal, async () => {
      await assertReadyForMerge(
        targetWorktree.path,
        targetExec,
        `The ${targetBranch} checkout (${targetWorktree.path})`
      )
      const mergeArgs =
        args.mode === 'rebase'
          ? ['merge', '--ff-only', sourceSha]
          : ['merge', '--no-edit', '-m', mergeMessage(sourceBranch, targetBranch), sourceSha]
      try {
        await git(mergeArgs, targetExec)
      } catch (error) {
        await git(['merge', '--abort'], targetExec).catch(() => undefined)
        throw new Error(`Merging into ${targetBranch} failed and was aborted. ${describe(error)}`)
      }
    })
  } else {
    await moveUncheckedOutTarget({
      sourceBranch,
      sourceSha,
      targetBranch,
      mode: args.mode,
      exec: sourceExec
    })
  }

  return {
    sourceBranch,
    targetBranch,
    newTargetSha: await revParse(`${HEADS_PREFIX}${targetBranch}`, sourceExec)
  }
}

/** A target with no checkout moves by ref update: fast-forward, or a merge commit built with merge-tree. */
async function moveUncheckedOutTarget(args: {
  sourceBranch: string
  sourceSha: string
  targetBranch: string
  mode: WorktreeMergeMode
  exec: ExecOptions
}): Promise<void> {
  const { sourceBranch, sourceSha, targetBranch, exec } = args
  const targetRef = `${HEADS_PREFIX}${targetBranch}`
  const targetSha = await revParse(targetRef, exec)
  if (await isAncestor(targetSha, sourceSha, exec)) {
    await git(['update-ref', targetRef, sourceSha, targetSha], exec)
    return
  }
  if (args.mode === 'rebase') {
    // Rebase just replayed onto the target, so this means the target moved concurrently.
    throw new Error(`${targetBranch} changed during the rebase. Try again.`)
  }
  let tree: string
  try {
    tree = (await git(['merge-tree', '--write-tree', targetSha, sourceSha], exec)).trim()
  } catch (error) {
    if (exitCode(error) === 1) {
      throw new Error(
        `${sourceBranch} conflicts with ${targetBranch}. Resolve the conflicts manually, then try again.`
      )
    }
    throw new Error(
      `Could not merge into ${targetBranch} without a checkout (requires Git 2.38+). Check out ${targetBranch} somewhere and try again. ${describe(error)}`
    )
  }
  const commit = (
    await git(
      [
        'commit-tree',
        tree.split('\n')[0],
        '-p',
        targetSha,
        '-p',
        sourceSha,
        '-m',
        mergeMessage(sourceBranch, targetBranch)
      ],
      exec
    )
  ).trim()
  await git(['update-ref', targetRef, commit, targetSha], exec)
}

/** Accept `x`, `refs/heads/x`, `origin/x` or `refs/remotes/origin/x`; remote refs land on (and may create) local `x`. */
async function resolveLocalTargetBranch(targetRef: string, exec: ExecOptions): Promise<string> {
  const trimmed = targetRef.trim()
  if (!trimmed) {
    throw new Error('Choose a target branch.')
  }
  const local = trimmed.startsWith(HEADS_PREFIX) ? trimmed.slice(HEADS_PREFIX.length) : trimmed
  if (await refExists(`${HEADS_PREFIX}${local}`, exec)) {
    return local
  }
  const remote = trimmed.startsWith(REMOTES_PREFIX) ? trimmed.slice(REMOTES_PREFIX.length) : trimmed
  const slash = remote.indexOf('/')
  if (slash > 0 && (await refExists(`${REMOTES_PREFIX}${remote}`, exec))) {
    const localName = remote.slice(slash + 1)
    if (!(await refExists(`${HEADS_PREFIX}${localName}`, exec))) {
      // Git's default autoSetupMerge tracks the remote when one is configured; --track would fail without it.
      await git(['branch', localName, `${REMOTES_PREFIX}${remote}`], exec)
    }
    return localName
  }
  throw new Error(`Branch ${trimmed} was not found.`)
}

async function assertReadyForMerge(
  worktreePath: string,
  exec: ExecOptions,
  label: string
): Promise<void> {
  const operation = await detectConflictOperation(worktreePath, exec)
  if (operation !== 'unknown') {
    throw new Error(`${label} has a ${operation} in progress. Finish or abort it first.`)
  }
  const status = await git(['status', '--porcelain', '--untracked-files=normal'], exec)
  if (status.trim()) {
    throw new Error(`${label} has uncommitted changes. Commit or stash them first.`)
  }
}

function mergeMessage(sourceBranch: string, targetBranch: string): string {
  return `Merge branch '${sourceBranch}' into ${targetBranch}`
}

async function git(args: string[], exec: ExecOptions): Promise<string> {
  return (await gitExecFileAsync(args, exec)).stdout
}

async function revParse(ref: string, exec: ExecOptions): Promise<string> {
  return (await git(['rev-parse', '--verify', `${ref}^{commit}`], exec)).trim()
}

async function refExists(ref: string, exec: ExecOptions): Promise<boolean> {
  try {
    await git(['show-ref', '--verify', '--quiet', ref], exec)
    return true
  } catch {
    return false
  }
}

async function isAncestor(
  ancestor: string,
  descendant: string,
  exec: ExecOptions
): Promise<boolean> {
  try {
    await git(['merge-base', '--is-ancestor', ancestor, descendant], exec)
    return true
  } catch {
    return false
  }
}

function exitCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
}

function describe(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'stderr' in error) {
    const stderr = String(error.stderr ?? '').trim()
    if (stderr) {
      return stderr
    }
  }
  return error instanceof Error ? error.message : String(error)
}
