import { getRelativePathInsideRoot, normalizeRelativePath } from '@/lib/path'

/** Worktree-relative POSIX Unity roots ('' = the whole worktree) from absolute project roots. */
export function toWorktreeRelativeUnityRoots(
  projectRoots: readonly string[],
  worktreePath: string
): string[] {
  const result: string[] = []
  for (const root of projectRoots) {
    if (getRelativePathInsideRoot(worktreePath, root) !== null) {
      return ['']
    }
    const relative = getRelativePathInsideRoot(root, worktreePath)
    if (relative !== null) {
      result.push(normalizeRelativePath(relative).replace(/\/+$/, ''))
    }
  }
  return result
}

/** True for a `.meta` file (worktree-relative) inside one of `hiddenRoots`. */
export function isHiddenUnityMetaPath(
  relativePath: string,
  hiddenRoots: readonly string[]
): boolean {
  if (hiddenRoots.length === 0 || !/\.meta$/i.test(relativePath)) {
    return false
  }
  const path = normalizeRelativePath(relativePath)
  return hiddenRoots.some((root) => root === '' || path.startsWith(`${root}/`))
}
