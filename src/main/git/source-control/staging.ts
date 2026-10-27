import type { GitRuntimeOptions } from '../git-runtime-options'
import { gitOptionsForWorktree } from '../git-runtime-options'
import { gitExecFileAsync } from '../runner'
import { invalidateGitReadCaches } from './git-read-cache-invalidation'
import { literalPathspec, runtimeGitPath } from './git-pathspec'
import { checkIgnoredPaths } from '../check-ignored-paths'
import { encodeGitPathspecs } from '../../../shared/git-pathspec-stdin'
import {
  stageGitWorktreeScope,
  type GitStageWorktreeScope,
  type GitStageWorktreeScopeReceipt
} from '../../../shared/git-stage-worktree-scope'
import { findExistingWorktreeSymlinkPaths } from '../worktree-symlink-detection'
import { redoWriteForDriveCheckoutSuspects } from './drive-checkout-suspect-writes'

const STAGE_WRITE = ['add', '--update'] as const

export async function stageFile(
  worktreePath: string,
  filePath: string,
  options: GitRuntimeOptions = {}
): Promise<void> {
  invalidateGitReadCaches()
  try {
    await gitExecFileAsync(
      ['add', '--', literalPathspec(filePath, worktreePath, options)],
      gitOptionsForWorktree(worktreePath, options)
    )
    await redoWriteForDriveCheckoutSuspects(worktreePath, [filePath], STAGE_WRITE, options)
  } finally {
    invalidateGitReadCaches()
  }
}

export async function unstageFile(
  worktreePath: string,
  filePath: string,
  options: GitRuntimeOptions = {}
): Promise<void> {
  invalidateGitReadCaches()
  try {
    // Reset treats an unborn HEAD as an empty tree, preserving the working file.
    await gitExecFileAsync(
      ['reset', '--quiet', '--', literalPathspec(filePath, worktreePath, options)],
      {
        ...gitOptionsForWorktree(worktreePath, options)
      }
    )
  } finally {
    invalidateGitReadCaches()
  }
}

function normalizeGitPathForCompare(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/\/+$/, '')
}

async function withoutIgnoredPaths(
  worktreePath: string,
  filePaths: readonly string[],
  options: GitRuntimeOptions
): Promise<string[]> {
  const ignored = await checkIgnoredPaths(
    worktreePath,
    filePaths.map((filePath) => runtimeGitPath(filePath, worktreePath, options)),
    options
  )
  const ignoredSet = new Set(ignored.map(normalizeGitPathForCompare))
  return filePaths.filter(
    (filePath) =>
      !ignoredSet.has(normalizeGitPathForCompare(runtimeGitPath(filePath, worktreePath, options)))
  )
}

// Use stdin to avoid argv limits and repeated index writes.
export async function bulkStageFiles(
  worktreePath: string,
  filePaths: string[],
  options: GitRuntimeOptions = {}
): Promise<void> {
  invalidateGitReadCaches()
  if (filePaths.length === 0) {
    return
  }
  const encodePaths = (paths: readonly string[]) =>
    encodeGitPathspecs(paths.map((filePath) => literalPathspec(filePath, worktreePath, options)))
  const addPaths = (stdin: ReturnType<typeof encodeGitPathspecs>) =>
    gitExecFileAsync(['add', '--pathspec-from-file=-', '--pathspec-file-nul'], {
      ...gitOptionsForWorktree(worktreePath, options),
      stdin
    })
  try {
    // Encode before spawning so invalid paths (embedded NUL) reject without touching Git.
    const stdin = encodePaths(filePaths)
    try {
      await addPaths(stdin)
    } catch (error) {
      // Git refuses the whole batch when any path is ignored; stage the rest instead.
      const stageablePaths = await withoutIgnoredPaths(worktreePath, filePaths, options).catch(
        () => null
      )
      if (!stageablePaths || stageablePaths.length === filePaths.length) {
        throw error
      }
      if (stageablePaths.length > 0) {
        await addPaths(encodePaths(stageablePaths))
      }
    }
    await redoWriteForDriveCheckoutSuspects(worktreePath, filePaths, STAGE_WRITE, options)
  } finally {
    invalidateGitReadCaches()
  }
}

// A capped status listing cannot enumerate every change for Stage All.
export async function stageWorktreeChanges(
  worktreePath: string,
  scope: GitStageWorktreeScope,
  options: GitRuntimeOptions & { sharedLinkPaths?: readonly string[] } = {}
): Promise<GitStageWorktreeScopeReceipt> {
  invalidateGitReadCaches()
  try {
    const gitOptions = gitOptionsForWorktree(worktreePath, options)
    // Directory-only ignore rules do not hide shared symlinks; exclude them from add --all.
    const excludedUntrackedPaths =
      scope === 'all' && options.sharedLinkPaths && options.sharedLinkPaths.length > 0
        ? await findExistingWorktreeSymlinkPaths(worktreePath, options.sharedLinkPaths, {
            wslDistro: options.wslDistro
          })
        : []
    const receipt = await stageGitWorktreeScope(
      scope,
      (args, stdin) =>
        gitExecFileAsync(args, stdin === undefined ? gitOptions : { ...gitOptions, stdin }),
      { excludedUntrackedPaths }
    )
    await redoWriteForDriveCheckoutSuspects(worktreePath, ['.'], STAGE_WRITE, options)
    return receipt
  } finally {
    invalidateGitReadCaches()
  }
}

// Use stdin to avoid argv limits and repeated index writes.
export async function bulkUnstageFiles(
  worktreePath: string,
  filePaths: string[],
  options: GitRuntimeOptions = {}
): Promise<void> {
  invalidateGitReadCaches()
  if (filePaths.length === 0) {
    return
  }
  try {
    await gitExecFileAsync(['reset', '--quiet', '--pathspec-from-file=-', '--pathspec-file-nul'], {
      ...gitOptionsForWorktree(worktreePath, options),
      stdin: encodeGitPathspecs(
        filePaths.map((filePath) => literalPathspec(filePath, worktreePath, options))
      )
    })
  } finally {
    invalidateGitReadCaches()
  }
}
