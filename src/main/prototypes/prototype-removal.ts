import { rm } from 'node:fs/promises'
import type { Store } from '../persistence'
import { listWorktreesStrict, removeWorktree } from '../git/worktree'
import { isInsidePrototypesRoot, isRegisteredRepoPath } from './prototype-location'

/** Caller must have already unregistered the prototype and stopped its terminals. */
export async function deletePrototypeFiles(
  store: Store,
  prototypePath: string
): Promise<{ warnings: string[] } | { error: string }> {
  // Why: this is an rm -rf driven by renderer input; only ever touch unregistered children of the prototypes root.
  if (!(await isInsidePrototypesRoot(prototypePath))) {
    return { error: 'Not a prototype folder' }
  }
  if (isRegisteredRepoPath(store, prototypePath)) {
    return { error: 'Prototype is still registered' }
  }
  const warnings: string[] = []
  const linkedWorktrees = await listWorktreesStrict(prototypePath)
    .then((worktrees) =>
      worktrees.filter((worktree) => !worktree.isMainWorktree && !worktree.prunable)
    )
    .catch(() => [])
  for (const worktree of linkedWorktrees) {
    try {
      await removeWorktree(prototypePath, worktree.path, true)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warnings.push(`Could not delete worktree ${worktree.path}: ${message}`)
    }
  }
  try {
    await rm(prototypePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { error: `Failed to delete prototype files: ${message}` }
  }
  return { warnings }
}
