import { useCallback, useMemo } from 'react'
import { getRelativePathInsideRoot } from '@/lib/path'
import {
  normalizeTreeRelativePath,
  toWorktreeRelativePath,
  treePathToAbsolute
} from './file-explorer-tree-relative-paths'
import type { FileTreeModelLike } from './use-file-explorer-tree-model'

/** Folder loader keyed by tree paths; the listing itself loads worktree-relative folders. */
export function useTreeRootDirLoader(
  loadDirs: (relativeDirs: readonly string[]) => Promise<void>,
  treeRootPath: string | null,
  worktreePath: string | null
): (treeDirs: readonly string[]) => Promise<void> {
  return useCallback(
    (treeDirs: readonly string[]) =>
      worktreePath && treeRootPath
        ? loadDirs(
            treeDirs.map((dir) =>
              toWorktreeRelativePath(treePathToAbsolute(treeRootPath, dir), worktreePath)
            )
          )
        : Promise.resolve(),
    [loadDirs, treeRootPath, worktreePath]
  )
}

/** Worktree-relative path of the single selected folder (read by the global "find in folder" shortcut). */
export function useSelectedTreeFolderRelativePath(
  model: FileTreeModelLike | null,
  selectedPaths: Set<string>,
  treeRootPath: string | null,
  worktreePath: string | null
): string | undefined {
  return useMemo(() => {
    if (!model || !worktreePath || !treeRootPath || selectedPaths.size !== 1) {
      return undefined
    }
    const selected = [...selectedPaths][0]
    const treeRelative = getRelativePathInsideRoot(selected, treeRootPath)
    if (!treeRelative) {
      return undefined
    }
    return model.getItem(normalizeTreeRelativePath(treeRelative))?.isDirectory()
      ? toWorktreeRelativePath(selected, worktreePath)
      : undefined
  }, [model, selectedPaths, treeRootPath, worktreePath])
}
