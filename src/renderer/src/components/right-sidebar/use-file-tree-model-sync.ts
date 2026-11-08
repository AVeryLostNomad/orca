import { useEffect, useRef, type MutableRefObject } from 'react'
import type { FileTree, FileTreeDirectoryHandle, FileTreeItemHandle } from '@pierre/trees'
import { useAppStore } from '@/store'
import { buildFileExplorerTreeGitStatus } from './file-explorer-tree-input'
import { getParentRelativeDir } from './file-explorer-loaded-dir-scope'
import { toWorktreeRelativeDirSet } from './file-explorer-tree-relative-paths'
import { scopeTreeGitStatus, toScopedTreePath } from './file-explorer-tree-scope'
import type { FileExplorerTreeFileMutation } from './file-explorer-tree-watch-mutations'
import { resetFileTreePathsWithExpansion } from './use-file-tree-expansion-sync'

/**
 * Resets the model when its input paths change. Why signature-only: expansion state is read
 * from the store at reset time, so expanding a folder never triggers a tree rebuild.
 */
export function useFileTreeContentReset({
  model,
  activeWorktreeId,
  treeRootPath,
  contentVersion,
  buildInputPaths,
  lastResetSignatureRef
}: {
  model: FileTree | null
  activeWorktreeId: string | null
  treeRootPath: string | null
  /** New identity whenever the listing, name-filter matches or visibility filters change. */
  contentVersion: object
  buildInputPaths: () => string[]
  lastResetSignatureRef: MutableRefObject<string | null>
}): void {
  const buildInputPathsRef = useRef(buildInputPaths)
  buildInputPathsRef.current = buildInputPaths
  // Why: a scope change recreates the model while this effect still sees the old one in that
  // commit; the signature it records must not let the new, empty model skip its first reset.
  const lastResetModelRef = useRef<FileTree | null>(null)
  useEffect(() => {
    if (!model || !activeWorktreeId || !treeRootPath) {
      return
    }
    const inputPaths = buildInputPathsRef.current()
    const signature = inputPaths.join('\n')
    if (signature === lastResetSignatureRef.current && model === lastResetModelRef.current) {
      return
    }
    const expanded = useAppStore.getState().expandedDirs[activeWorktreeId] ?? new Set<string>()
    resetFileTreePathsWithExpansion(
      model,
      inputPaths,
      toWorktreeRelativeDirSet(expanded, treeRootPath)
    )
    lastResetSignatureRef.current = signature
    lastResetModelRef.current = model
  }, [model, activeWorktreeId, treeRootPath, lastResetSignatureRef, contentVersion])
}

function asDirectoryHandle(handle: FileTreeItemHandle | null): FileTreeDirectoryHandle | null {
  return handle && 'expand' in handle ? handle : null
}

/** Re-open newly listed folders (tree paths) the user had expanded before the expansion sync forgets them. */
export function expandRestoredTreeDirs(
  target: FileTree,
  treeMutations: readonly FileExplorerTreeFileMutation[],
  expandedTreeDirs: ReadonlySet<string>
): void {
  for (const mutation of treeMutations) {
    if (mutation.kind !== 'create' || !mutation.isDirectory) {
      continue
    }
    if (!expandedTreeDirs.has(mutation.relativePath)) {
      continue
    }
    const parent = getParentRelativeDir(mutation.relativePath)
    // Why: expand() opens collapsed ancestors too, so only follow an open parent.
    if (parent && !asDirectoryHandle(target.getItem(parent))?.isExpanded()) {
      continue
    }
    asDirectoryHandle(target.getItem(mutation.relativePath))?.expand()
  }
}

/** Mirrors the worktree's git status (and visible ignored paths) onto the possibly scoped tree. */
export function useFileTreeGitStatus({
  model,
  activeWorktreeId,
  activeRepoSupportsGit,
  showGitIgnoredFiles,
  ignoredSet,
  scopePrefix
}: {
  model: FileTree | null
  activeWorktreeId: string | null
  activeRepoSupportsGit: boolean
  showGitIgnoredFiles: boolean
  ignoredSet: Set<string>
  scopePrefix: string
}): void {
  const gitStatusEntries = useAppStore((s) =>
    activeWorktreeId ? s.gitStatusByWorktree[activeWorktreeId] : undefined
  )
  useEffect(() => {
    if (!model) {
      return
    }
    if (!activeRepoSupportsGit) {
      model.setGitStatus([])
      return
    }
    // Why: a trailing slash tells the library an ignored path is a folder so its row dims too.
    const visibleIgnoredPaths = showGitIgnoredFiles
      ? [...ignoredSet].map((path) =>
          model.getItem(toScopedTreePath(scopePrefix, path) ?? path)?.isDirectory()
            ? `${path}/`
            : path
        )
      : []
    model.setGitStatus(
      scopeTreeGitStatus(
        scopePrefix,
        buildFileExplorerTreeGitStatus(gitStatusEntries ?? [], visibleIgnoredPaths)
      )
    )
  }, [model, activeRepoSupportsGit, gitStatusEntries, ignoredSet, showGitIgnoredFiles, scopePrefix])
}
