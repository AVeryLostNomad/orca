import { useCallback, useRef } from 'react'
import type React from 'react'
import { joinPath } from '@/lib/path'
import {
  encodeWorkspaceFilePaths,
  WORKSPACE_FILE_PATH_MIME,
  WORKSPACE_FILE_PATHS_MIME
} from '@/lib/workspace-file-drag'
import { resolveFileTreeRowFromEvent } from './use-file-tree-activation'
import { normalizeTreeRelativePath } from './file-explorer-tree-relative-paths'

type UseFileTreeDragOutParams = {
  worktreePath: string | null
  selectedPaths: Set<string>
}

type UseFileTreeDragOutResult = {
  /** True while a drag that started on a tree row is in flight. */
  isRowDragActive: () => boolean
  handleDragStartCapture: (event: React.DragEvent<HTMLDivElement>) => void
  handleDragEndCapture: (event: React.DragEvent<HTMLDivElement>) => void
}

/**
 * Stamps Orca's workspace-file MIME payload onto drags starting on tree rows.
 *
 * Why: the payload is what editor tabs and terminals accept, and the preload's
 * native-drop hijack only lets drops through when this MIME is present — the
 * library's internal 'text/plain' payload alone would be swallowed.
 */
export function useFileTreeDragOut({
  worktreePath,
  selectedPaths
}: UseFileTreeDragOutParams): UseFileTreeDragOutResult {
  const draggingRef = useRef(false)
  const selectedPathsRef = useRef(selectedPaths)
  selectedPathsRef.current = selectedPaths

  const handleDragStartCapture = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!worktreePath) {
        return
      }
      const row = resolveFileTreeRowFromEvent(event.nativeEvent)
      if (!row) {
        return
      }
      const absolutePath = joinPath(worktreePath, normalizeTreeRelativePath(row.relativePath))
      const selected = selectedPathsRef.current
      const paths = selected.has(absolutePath) && selected.size > 1 ? [...selected] : [absolutePath]
      event.dataTransfer.setData(WORKSPACE_FILE_PATH_MIME, absolutePath)
      if (paths.length > 1) {
        event.dataTransfer.setData(WORKSPACE_FILE_PATHS_MIME, encodeWorkspaceFilePaths(paths))
      }
      draggingRef.current = true
    },
    [worktreePath]
  )

  const handleDragEndCapture = useCallback(() => {
    draggingRef.current = false
  }, [])

  const isRowDragActive = useCallback(() => draggingRef.current, [])

  return { isRowDragActive, handleDragStartCapture, handleDragEndCapture }
}
