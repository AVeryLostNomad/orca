import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import type { FileTreeDirectoryHandle } from '@pierre/trees'
import { dirname, joinPath } from '@/lib/path'
import { hasNativeFileDragTypes } from '../../../../shared/native-file-drop'
import { useFileExplorerImport } from './useFileExplorerImport'
import { normalizeTreeRelativePath } from './file-explorer-tree-relative-paths'
import type { FileExplorerOperationOwner } from './file-explorer-types'
import type { FileTreeModelLike } from './use-file-explorer-tree-model'

const NATIVE_DRAG_EXPAND_DELAY_MS = 500

/** Directory a native OS drag hovering this composed event should target, worktree-relative. */
export function resolveNativeDropRelativeDir(event: Event): string | null {
  for (const element of event.composedPath()) {
    if (!(element instanceof HTMLElement)) {
      continue
    }
    const itemPath = element.dataset.itemPath
    if (itemPath === undefined) {
      continue
    }
    if (element.dataset.itemType === 'folder') {
      return normalizeTreeRelativePath(itemPath)
    }
    const parentPath =
      element.dataset.itemParentPath ?? dirname(normalizeTreeRelativePath(itemPath))
    return parentPath === '.' ? '' : normalizeTreeRelativePath(parentPath)
  }
  return null
}

type UseFileTreeNativeImportParams = {
  model: FileTreeModelLike | null
  activeWorktreeId: string | null
  worktreePath: string | null
  operationOwner: FileExplorerOperationOwner | undefined
  refreshFileList: () => void
  applySelectedPaths: (absolutePaths: Set<string>) => void
}

type UseFileTreeNativeImportResult = {
  /** Absolute directory native drops should land in; null means the root. */
  nativeDropDir: string | null
  isNativeDragOver: boolean
  handleNativeDragOver: (event: React.DragEvent<HTMLDivElement>) => void
  handleNativeDragLeave: (event: React.DragEvent<HTMLDivElement>) => void
}

/**
 * External OS file drops onto the tree: resolves the hovered directory into
 * the wrapper's `data-native-file-drop-dir` (the preload reads it at drop
 * time), auto-expands hovered folders, and runs the import pipeline.
 */
export function useFileTreeNativeImport({
  model,
  activeWorktreeId,
  worktreePath,
  operationOwner,
  refreshFileList,
  applySelectedPaths
}: UseFileTreeNativeImportParams): UseFileTreeNativeImportResult {
  const [nativeDropRelativeDir, setNativeDropRelativeDir] = useState<string | null>(null)
  const [isNativeDragOver, setIsNativeDragOver] = useState(false)
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const expandTargetRef = useRef<string | null>(null)

  const clearExpandTimer = useCallback(() => {
    if (expandTimerRef.current !== null) {
      clearTimeout(expandTimerRef.current)
      expandTimerRef.current = null
    }
    expandTargetRef.current = null
  }, [])

  useEffect(() => clearExpandTimer, [clearExpandTimer])

  const clearNativeDragState = useCallback(() => {
    setNativeDropRelativeDir(null)
    setIsNativeDragOver(false)
    clearExpandTimer()
  }, [clearExpandTimer])

  const handleNativeDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasNativeFileDragTypes(event.dataTransfer.types)) {
        return
      }
      setIsNativeDragOver(true)
      const relativeDir = resolveNativeDropRelativeDir(event.nativeEvent)
      setNativeDropRelativeDir(relativeDir)
      // Why: expand-only after the old 500ms hover delay so the user can drop
      // into a collapsed folder's children.
      if (relativeDir && model && expandTargetRef.current !== relativeDir) {
        clearExpandTimer()
        const handle = model.getItem(relativeDir)
        if (handle?.isDirectory() && !(handle as FileTreeDirectoryHandle).isExpanded()) {
          expandTargetRef.current = relativeDir
          expandTimerRef.current = setTimeout(() => {
            expandTimerRef.current = null
            expandTargetRef.current = null
            const dirHandle = model.getItem(relativeDir)
            if (dirHandle?.isDirectory()) {
              ;(dirHandle as FileTreeDirectoryHandle).expand()
            }
          }, NATIVE_DRAG_EXPAND_DELAY_MS)
        }
      }
    },
    [clearExpandTimer, model]
  )

  const handleNativeDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const related = event.relatedTarget
      if (related instanceof Node && event.currentTarget.contains(related)) {
        return
      }
      clearNativeDragState()
    },
    [clearNativeDragState]
  )

  useFileExplorerImport({
    worktreePath,
    activeWorktreeId,
    refreshDir: useCallback(async () => refreshFileList(), [refreshFileList]),
    clearNativeDragState,
    setSelectedPath: useCallback(
      (path: string | null) => {
        if (path) {
          applySelectedPaths(new Set([path]))
        }
      },
      [applySelectedPaths]
    ),
    operationOwner
  })

  const nativeDropDir =
    worktreePath && nativeDropRelativeDir ? joinPath(worktreePath, nativeDropRelativeDir) : null

  return { nativeDropDir, isNativeDragOver, handleNativeDragOver, handleNativeDragLeave }
}
