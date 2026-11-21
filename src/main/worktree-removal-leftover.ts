import { lstat, readdir, rmdir } from 'node:fs/promises'
import { worktreeInUseError } from './git/worktree-trash-removal'
import { join } from 'node:path'
import type { RemoveWorktreeResult } from '../shared/worktree/create-types'
import type { GitWorktreeInfo } from '../shared/worktree/types'
import { listWorktreesStrict } from './git/worktree'
import { getErrorCode } from './git/worktree-operation-options'
import { areWorktreePathsEqual } from './git/worktree-path-comparison'
import { CLIENT_REMOVAL_HOME } from './worktree-removal-home-guard'
import {
  failedWorktreeRemovals,
  persistWorktreeRemovalRecords,
  worktreeCheckoutExists
} from './worktree-removal-table'
import {
  assertWorktreeDoesNotContainRegisteredWorktree,
  canSafelyRemoveOrphanedWorktreeDirectory
} from './worktree-removal-safety'

/** Absent .git or a proven orphan marker can identify a leftover; live or foreign registrations cannot. */
export async function isUnregisteredRemovalLeftover(
  repoPath: string,
  worktreePath: string
): Promise<boolean> {
  try {
    await lstat(join(worktreePath, '.git'))
  } catch (error) {
    return getErrorCode(error) === 'ENOENT'
  }
  return canSafelyRemoveOrphanedWorktreeDirectory(worktreePath, repoPath, CLIENT_REMOVAL_HOME)
}

export function differentCheckoutAtPathError(worktreePath: string): Error {
  return new Error(
    `A different checkout is now at ${worktreePath}; Orca left it in place. Delete it again to remove it.`
  )
}

export async function isCheckoutRegistered(record: {
  repoPath: string
  worktreePath: string
}): Promise<boolean> {
  return (await listWorktreesStrict(record.repoPath)).some((worktree) =>
    areWorktreePathsEqual(worktree.path, record.worktreePath)
  )
}

export function unregisteredFolderRefusal(worktreePath: string): Error {
  return new Error(
    `${worktreePath} is no longer a Git worktree, so its folder was left on disk. Delete the folder yourself to finish removing this workspace.`
  )
}

/** Name nested worktrees before asking the user to remove an unregistered folder. */
export async function assertUnregisteredCheckoutGone(
  worktreePath: string,
  registeredWorktrees: readonly Pick<GitWorktreeInfo, 'path'>[] = []
): Promise<void> {
  if (await worktreeCheckoutExists(worktreePath)) {
    assertWorktreeDoesNotContainRegisteredWorktree(worktreePath, registeredWorktrees)
    // Why: Git for Windows unregisters, deletes every file, then fails on the folder itself when a shell's
    // cwd is inside it. An empty folder is that half-finished delete; anything with files may be the
    // user's (kept files, or a new folder put at the path), so only the empty case is finished here.
    if (await removeEmptyLeftoverFolder(worktreePath)) {
      return
    }
    throw unregisteredFolderRefusal(worktreePath)
  }
}

/** True once an empty leftover folder is gone; false (untouched) when it holds anything. */
async function removeEmptyLeftoverFolder(worktreePath: string): Promise<boolean> {
  const entries = await readdir(worktreePath).catch(() => null)
  if (entries === null || entries.length > 0) {
    return false
  }
  try {
    // rmdir refuses non-empty directories, so a file created since readdir is never lost.
    await rmdir(worktreePath)
    return true
  } catch (error) {
    if (getErrorCode(error) === 'ENOTEMPTY') {
      return false
    }
    if (['EPERM', 'EBUSY', 'EACCES'].includes(getErrorCode(error) ?? '')) {
      throw worktreeInUseError(worktreePath, error)
    }
    throw error
  }
}

/** Registered paths use normal deletion; otherwise require the folder gone before retrying recorded cleanup. */
export async function retryFailedRemovalUnlessRegistered(
  worktreeId: string,
  worktreePath: string,
  registeredWorktrees: readonly Pick<GitWorktreeInfo, 'path'>[],
  retry: () => Promise<RemoveWorktreeResult> | undefined
): Promise<boolean> {
  if (registeredWorktrees.some((worktree) => areWorktreePathsEqual(worktree.path, worktreePath))) {
    if (failedWorktreeRemovals.delete(worktreeId)) {
      void persistWorktreeRemovalRecords()
    }
    return false
  }
  const failed = failedWorktreeRemovals.get(worktreeId)
  if (failed) {
    await assertUnregisteredCheckoutGone(failed.worktreePath, registeredWorktrees)
  }
  return retry() !== undefined
}
