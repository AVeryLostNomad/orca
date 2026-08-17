import type {
  GitStatus as TreeGitStatus,
  GitStatusEntry as TreeGitStatusEntry
} from '@pierre/trees'
import type { GitFileStatus, GitStatusEntry } from '../../../../shared/git-status-types'
import { normalizeRelativePath } from '@/lib/path'
import { isDotfileRelativePath } from './file-explorer-entries'
import { buildStatusMap, isPathIgnored } from './status-display'

export type FileExplorerTreeInputFilters = {
  showDotfiles: boolean
  showGitIgnoredFiles: boolean
  ignoredSet: Set<string>
}

/** Visibility of one worktree-relative path under the explorer's dotfile/gitignore toggles. */
export function passesFileExplorerTreeFilters(
  relativePath: string,
  filters: FileExplorerTreeInputFilters
): boolean {
  // Why: directory entries carry a trailing slash the filter helpers don't expect.
  const path = relativePath.replace(/\/+$/, '')
  if (!path) {
    return false
  }
  if (!filters.showDotfiles && isDotfileRelativePath(path)) {
    return false
  }
  if (!filters.showGitIgnoredFiles && isPathIgnored(filters.ignoredSet, path)) {
    return false
  }
  return true
}

/**
 * Filter the worktree's flat file list into @pierre/trees input paths
 * (POSIX-separated, worktree-relative), applying the explorer's dotfile and
 * gitignore visibility toggles. Directory entries keep their trailing slash.
 */
export function buildFileExplorerTreeInputPaths(
  relativePaths: readonly string[],
  filters: FileExplorerTreeInputFilters
): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const rawPath of relativePaths) {
    const path = normalizeRelativePath(rawPath)
    if (!path || seen.has(path)) {
      continue
    }
    if (!passesFileExplorerTreeFilters(path, filters)) {
      continue
    }
    seen.add(path)
    result.push(path)
  }
  return result
}

// Why: the tree library has no 'copied' status; a copy is a new file to the user.
const TREE_STATUS_BY_GIT_STATUS: Record<GitFileStatus, TreeGitStatus> = {
  modified: 'modified',
  added: 'added',
  deleted: 'deleted',
  renamed: 'renamed',
  untracked: 'untracked',
  copied: 'added'
}

/**
 * Map Orca git status entries (plus visible gitignored paths, which the
 * library dims natively via the 'ignored' status) into tree status entries.
 */
export function buildFileExplorerTreeGitStatus(
  entries: readonly GitStatusEntry[],
  visibleIgnoredPaths: readonly string[]
): TreeGitStatusEntry[] {
  const statusByPath = buildStatusMap([...entries])
  const result: TreeGitStatusEntry[] = []
  for (const [path, status] of statusByPath) {
    result.push({ path, status: TREE_STATUS_BY_GIT_STATUS[status] })
  }
  for (const rawPath of visibleIgnoredPaths) {
    const path = normalizeRelativePath(rawPath)
    if (path && !statusByPath.has(path)) {
      result.push({ path, status: 'ignored' })
    }
  }
  return result
}
