// Windows fast path: Git for Windows deletes a large checkout file-by-file (20-35 s for node_modules), and
// a process whose cwd is inside it only fails the delete at the very end, after every file is gone and the
// worktree is already unregistered. Renaming first detects that lock up front and lets the card go now.
import { runProcess } from '@orca/process-host'
import { randomBytes } from 'node:crypto'
import { lstat, mkdir, rename, rmdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { WORKTREE_TRASH_DIR_NAME } from '../worktree-trash'
import { getErrorCode } from './worktree-operation-options'

const RENAME_RETRY_DELAYS_MS = [100, 250, 500]
const LOCK_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

/** Error carrying `code`/`path` like host-tree-removal's, so existing force/lock classification still applies. */
export function worktreeInUseError(worktreePath: string, cause: unknown): Error {
  return Object.assign(
    new Error(
      `${worktreePath} is open in another program (often a terminal or editor whose current folder is inside it). Close that program or change its folder, then delete again. Nothing was deleted.`,
      { cause }
    ),
    { code: getErrorCode(cause) ?? 'EBUSY', path: worktreePath }
  )
}

/** Sibling trash path on the same volume, named so the startup sweep drains anything a crash leaves. */
export function trashPathFor(worktreePath: string): string {
  const name = `wt-${Date.now()}-${randomBytes(4).toString('hex')}`
  return join(dirname(resolve(worktreePath)), WORKTREE_TRASH_DIR_NAME, name)
}

/** Move the checkout aside; throws worktreeInUseError when something still holds it. */
export async function renameWorktreeToTrash(worktreePath: string): Promise<string> {
  const trashPath = trashPathFor(worktreePath)
  await mkdir(dirname(trashPath), { recursive: true })
  let lastError: unknown
  for (let attempt = 0; attempt <= RENAME_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await rename(worktreePath, trashPath)
      return trashPath
    } catch (error) {
      lastError = error
      if (!LOCK_CODES.has(getErrorCode(error) ?? '')) {
        throw error
      }
      // Defender/indexer handles are transient; a real holder (a shell's cwd) persists past these retries.
      const delay = RENAME_RETRY_DELAYS_MS[attempt]
      if (delay === undefined) {
        break
      }
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw worktreeInUseError(worktreePath, lastError)
}

/** Restore a checkout whose unregistration failed, so the worktree is left exactly as it was. */
export async function restoreWorktreeFromTrash(trashPath: string, worktreePath: string) {
  await rename(trashPath, worktreePath)
}

const pendingTrashDeletes = new Set<Promise<void>>()

/** Delete a trashed checkout off the request path, then drop its trash root once empty. */
export function scheduleTrashDelete(trashPath: string): void {
  const run = deleteTreeInChildProcess(trashPath)
    .then(() => rmdir(dirname(trashPath)).catch(() => undefined))
    .catch((error: unknown) =>
      console.warn(`[git] background delete of removed worktree ${trashPath} failed`, error)
    )
    .finally(() => pendingTrashDeletes.delete(run))
  pendingTrashDeletes.add(run)
}

/** Resolves once every scheduled trash delete has settled (tests, shutdown). */
export async function waitForPendingTrashDeletes(): Promise<void> {
  await Promise.all(pendingTrashDeletes)
}

/**
 * Delete a tree in a separate process. Why not fs.rm: one request per entry on libuv's 4-thread pool
 * stalled every other main-process fs call for minutes (#23837).
 */
export async function deleteTreeInChildProcess(
  targetPath: string,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  await runProcess(
    platform === 'win32'
      ? {
          program: process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe',
          // The \\?\ prefix lets rd delete paths beyond MAX_PATH, which deep node_modules trees exceed.
          args: ['/d', '/s', '/c', `rd /s /q "\\\\?\\${resolve(targetPath)}"`],
          windowsVerbatimArguments: true,
          // A large tree takes tens of seconds; killing rd halfway would only leave more to sweep.
          timeoutMs: null,
          maxOutputBytes: 16_384
        }
      : { program: 'rm', args: ['-rf', '--', targetPath], timeoutMs: null, maxOutputBytes: 16_384 }
  )
  // rd exits 0 even when some files stayed locked; the path's existence is the real verdict.
  try {
    await lstat(targetPath)
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') {
      return
    }
    throw error
  }
  throw new Error(`Could not fully delete ${targetPath}; it will be retried on next launch.`)
}
