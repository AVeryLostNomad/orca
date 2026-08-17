import { normalizeRelativePath } from '@/lib/path'
import { relativePathInsideRoot } from '../../../../shared/cross-platform-path'

export function getExternalFileChangeRelativePath(
  worktreePath: string,
  absolutePath: string,
  isDirectory: boolean | undefined
): string | null {
  if (isDirectory === true) {
    return null
  }

  const relativePath = relativePathInsideRoot(worktreePath, absolutePath)
  if (relativePath === null || relativePath === '') {
    return null
  }

  // Why: EditorPanel reloads tabs only from a worktree-relative path, not the watcher's absolute one; normalize or contents go stale.
  return normalizeRelativePath(relativePath)
}
