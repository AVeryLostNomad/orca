import { getRelativePathInsideRoot, joinPath, normalizeRelativePath } from '@/lib/path'

/** Canonical tree paths for directories can carry a trailing slash; store paths never do. */
export function normalizeTreeRelativePath(path: string): string {
  return normalizeRelativePath(path).replace(/\/+$/, '')
}

/** Store expandedDirs hold absolute paths; the tree model speaks worktree-relative POSIX. */
export function toWorktreeRelativeDirSet(
  absolutePaths: Iterable<string>,
  worktreePath: string
): Set<string> {
  const result = new Set<string>()
  for (const absolutePath of absolutePaths) {
    const relative = getRelativePathInsideRoot(absolutePath, worktreePath)
    if (relative) {
      result.add(normalizeTreeRelativePath(relative))
    }
  }
  return result
}

export function toAbsoluteDirSet(
  relativePaths: Iterable<string>,
  worktreePath: string
): Set<string> {
  const result = new Set<string>()
  for (const relativePath of relativePaths) {
    result.add(joinPath(worktreePath, relativePath))
  }
  return result
}

/** Absolute path of a tree-model path; the tree root may sit below the worktree (Unity scope). */
export function treePathToAbsolute(treeRootPath: string, treePath: string): string {
  return joinPath(treeRootPath, normalizeTreeRelativePath(treePath))
}

/** Worktree-relative POSIX path of an absolute path ('' for the root or anything outside it). */
export function toWorktreeRelativePath(absolutePath: string, worktreePath: string): string {
  return normalizeTreeRelativePath(getRelativePathInsideRoot(absolutePath, worktreePath) ?? '')
}

/** 'a/b/c.txt' → ['a', 'a/b'] — every ancestor directory, shallowest first. */
export function getRelativeAncestorDirs(relativePath: string): string[] {
  const normalized = normalizeTreeRelativePath(relativePath)
  const segments = normalized.split('/')
  const ancestors: string[] = []
  for (let i = 1; i < segments.length; i += 1) {
    ancestors.push(segments.slice(0, i).join('/'))
  }
  return ancestors
}
