import { useCallback, useRef, useState } from 'react'
import { joinPath } from '@/lib/path'
import {
  normalizeTreeRelativePath,
  toWorktreeRelativeDirSet
} from './file-explorer-tree-relative-paths'
import type { FileTreeModelLike } from './use-file-explorer-tree-model'

const EMPTY_SELECTION = new Set<string>()

type UseFileTreeSelectionBridgeResult = {
  /** Absolute paths mirrored from the tree's selection for menus and deletion. */
  selectedPaths: Set<string>
  handleSelectionChange: (relativePaths: readonly string[]) => void
  /** Push a selection back into the tree (deletion cleanup keeps survivors selected). */
  applySelectedPaths: (absolutePaths: Set<string>) => void
}

/** Mirrors tree selection (relative) into the absolute-path set the explorer commands use. */
export function useFileTreeSelectionBridge({
  model,
  worktreePath
}: {
  model: FileTreeModelLike | null
  worktreePath: string | null
}): UseFileTreeSelectionBridgeResult {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(EMPTY_SELECTION)
  const worktreePathRef = useRef(worktreePath)
  worktreePathRef.current = worktreePath
  const modelRef = useRef(model)
  modelRef.current = model

  const handleSelectionChange = useCallback((relativePaths: readonly string[]) => {
    const root = worktreePathRef.current
    if (!root) {
      setSelectedPaths(EMPTY_SELECTION)
      return
    }
    setSelectedPaths(
      new Set(relativePaths.map((path) => joinPath(root, normalizeTreeRelativePath(path))))
    )
  }, [])

  const applySelectedPaths = useCallback((absolutePaths: Set<string>) => {
    const currentModel = modelRef.current
    const root = worktreePathRef.current
    if (!currentModel || !root) {
      return
    }
    const nextRelative = toWorktreeRelativeDirSet(absolutePaths, root)
    for (const selected of currentModel.getSelectedPaths()) {
      if (!nextRelative.has(normalizeTreeRelativePath(selected))) {
        currentModel.getItem(selected)?.deselect()
      }
    }
    for (const relative of nextRelative) {
      const item = currentModel.getItem(relative)
      if (item && !item.isSelected()) {
        item.select()
      }
    }
    setSelectedPaths(new Set(absolutePaths))
  }, [])

  return { selectedPaths, handleSelectionChange, applySelectedPaths }
}
