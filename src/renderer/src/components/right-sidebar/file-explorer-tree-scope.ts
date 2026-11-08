import type { GitStatusEntry as TreeGitStatusEntry } from '@pierre/trees'
import type { FileExplorerTreeFileMutation } from './file-explorer-tree-watch-mutations'

// The tree model can be rooted at a worktree subfolder (`prefix`, worktree-relative POSIX,
// '' = the whole worktree); the listing, watcher and git status stay worktree-relative.

/** Tree-model path of a worktree-relative path; null when it is the scope root or outside it. */
export function toScopedTreePath(prefix: string, worktreeRelativePath: string): string | null {
  if (!prefix) {
    return worktreeRelativePath
  }
  const scopeDir = `${prefix}/`
  if (!worktreeRelativePath.startsWith(scopeDir)) {
    return null
  }
  const scoped = worktreeRelativePath.slice(scopeDir.length)
  return scoped && scoped !== '/' ? scoped : null
}

export function scopeTreeInputPaths(prefix: string, paths: readonly string[]): string[] {
  if (!prefix) {
    return [...paths]
  }
  const result: string[] = []
  for (const path of paths) {
    const scoped = toScopedTreePath(prefix, path)
    if (scoped !== null) {
      result.push(scoped)
    }
  }
  return result
}

/** True when `path` is the scope root or one of its ancestors, which the scoped tree cannot show. */
function containsScopeRoot(prefix: string, path: string): boolean {
  return path === prefix || prefix.startsWith(`${path}/`)
}

/**
 * Worktree mutations in tree coordinates. Moves across the scope boundary become a create or
 * delete; null means the scope root itself moved or vanished, so the caller must relist.
 */
export function scopeTreeMutations(
  prefix: string,
  mutations: readonly FileExplorerTreeFileMutation[]
): FileExplorerTreeFileMutation[] | null {
  if (!prefix) {
    return [...mutations]
  }
  const result: FileExplorerTreeFileMutation[] = []
  for (const mutation of mutations) {
    if (mutation.kind !== 'rename') {
      if (containsScopeRoot(prefix, mutation.relativePath)) {
        // Listing the scope root's ancestors creates them; only their removal invalidates the tree.
        if (mutation.kind === 'create') {
          continue
        }
        return null
      }
      const relativePath = toScopedTreePath(prefix, mutation.relativePath)
      if (relativePath !== null) {
        result.push({ ...mutation, relativePath })
      }
      continue
    }
    if (
      containsScopeRoot(prefix, mutation.fromRelativePath) ||
      containsScopeRoot(prefix, mutation.toRelativePath)
    ) {
      return null
    }
    const from = toScopedTreePath(prefix, mutation.fromRelativePath)
    const to = toScopedTreePath(prefix, mutation.toRelativePath)
    if (from !== null && to !== null) {
      result.push({ ...mutation, fromRelativePath: from, toRelativePath: to })
    } else if (from !== null) {
      result.push({ kind: 'delete', relativePath: from, isDirectory: mutation.isDirectory })
    } else if (to !== null) {
      result.push({ kind: 'create', relativePath: to, isDirectory: mutation.isDirectory })
    }
  }
  return result
}

export function scopeTreeGitStatus(
  prefix: string,
  entries: readonly TreeGitStatusEntry[]
): TreeGitStatusEntry[] {
  if (!prefix) {
    return [...entries]
  }
  const result: TreeGitStatusEntry[] = []
  for (const entry of entries) {
    const path = toScopedTreePath(prefix, entry.path)
    if (path !== null) {
      result.push({ ...entry, path })
    }
  }
  return result
}
