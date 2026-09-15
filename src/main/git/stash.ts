import {
  applyGitStash,
  dropGitStash,
  listGitStashFiles,
  listGitStashes,
  pushGitStash,
  type GitStashApplyResult,
  type GitStashDropResult,
  type GitStashFilesResult,
  type GitStashListResult,
  type GitStashPushRequest,
  type GitStashPushResult
} from '../../shared/git-stash'
import type { GitRuntimeOptions } from './git-runtime-options'
import { gitOptionsForWorktree, gitReadOptionsForWorktree } from './git-runtime-options'
import { gitExecFileAsync } from './runner'
import { invalidateGitReadCaches } from './status'

export async function listStashes(
  worktreePath: string,
  options: GitRuntimeOptions = {}
): Promise<GitStashListResult> {
  return listGitStashes(
    (args, cwd) => gitExecFileAsync(args, gitReadOptionsForWorktree(cwd, options)),
    worktreePath
  )
}

export async function listStashFiles(
  worktreePath: string,
  sha: string,
  options: GitRuntimeOptions = {}
): Promise<GitStashFilesResult> {
  return listGitStashFiles(
    (args, cwd) => gitExecFileAsync(args, gitReadOptionsForWorktree(cwd, options)),
    worktreePath,
    sha
  )
}

async function runStashMutation<T>(run: () => Promise<T>): Promise<T> {
  invalidateGitReadCaches()
  try {
    return await run()
  } finally {
    invalidateGitReadCaches()
  }
}

export function pushStash(
  worktreePath: string,
  request: GitStashPushRequest,
  options: GitRuntimeOptions = {}
): Promise<GitStashPushResult> {
  return runStashMutation(() =>
    pushGitStash(
      (args, cwd) => gitExecFileAsync(args, gitOptionsForWorktree(cwd, options)),
      worktreePath,
      request
    )
  )
}

export function applyStash(
  worktreePath: string,
  sha: string,
  options: GitRuntimeOptions = {}
): Promise<GitStashApplyResult> {
  return runStashMutation(() =>
    applyGitStash(
      (args, cwd) => gitExecFileAsync(args, gitOptionsForWorktree(cwd, options)),
      worktreePath,
      sha
    )
  )
}

export function dropStash(
  worktreePath: string,
  sha: string,
  options: GitRuntimeOptions = {}
): Promise<GitStashDropResult> {
  return runStashMutation(() =>
    dropGitStash(
      (args, cwd) => gitExecFileAsync(args, gitOptionsForWorktree(cwd, options)),
      worktreePath,
      sha
    )
  )
}
