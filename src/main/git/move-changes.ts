import {
  moveChangesBetweenWorktrees,
  type GitMoveChangesResult
} from '../../shared/git-move-changes'
import type { GitRuntimeOptions } from './git-runtime-options'
import { gitOptionsForWorktree } from './git-runtime-options'
import { gitExecFileAsync } from './runner'
import { invalidateGitReadCaches } from './status'

/**
 * Move all uncommitted changes from one local worktree into another worktree
 * of the same repository. Both worktrees run on the same host, so one
 * GitRuntimeOptions (WSL distro etc.) covers both.
 */
export async function moveChangesToWorktree(
  sourceWorktreePath: string,
  targetWorktreePath: string,
  options: GitRuntimeOptions = {}
): Promise<GitMoveChangesResult> {
  invalidateGitReadCaches()
  try {
    return await moveChangesBetweenWorktrees(
      (args, cwd) => gitExecFileAsync(args, gitOptionsForWorktree(cwd, options)),
      sourceWorktreePath,
      targetWorktreePath
    )
  } finally {
    invalidateGitReadCaches()
  }
}
