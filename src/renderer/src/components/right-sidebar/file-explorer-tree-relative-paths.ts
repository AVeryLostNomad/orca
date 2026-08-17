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
