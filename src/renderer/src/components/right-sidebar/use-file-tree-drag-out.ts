import { useCallback, useRef } from 'react'
import type React from 'react'
import { joinPath } from '@/lib/path'
import {
  encodeWorkspaceFilePaths,
  WORKSPACE_FILE_PATH_MIME,
  WORKSPACE_FILE_PATHS_MIME,
  writeWorkspaceFileDragSourceIfResolved
} from '@/lib/workspace-file-drag'
import { resolveFileTreeRowFromEvent } from './use-file-tree-activation'
import { normalizeTreeRelativePath } from './file-explorer-tree-relative-paths'
import { getFileExplorerOperationExecutionHostId } from './file-explorer-operation-owner'
import type { FileExplorerOperationOwner } from './file-explorer-types'

type UseFileTreeDragOutParams = {
  activeWorktreeId: string | null
  worktreePath: string | null
  /** The whole tree comes from one listing, so one owner covers every dragged path. */
  operationOwner: FileExplorerOperationOwner | undefined
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
 * Why: the payload (with its source-host stamp) is what editor tabs and
 * terminals accept; the library's internal 'text/plain' payload alone is not.
 */
export function useFileTreeDragOut({
  activeWorktreeId,
  worktreePath,
  operationOwner,
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
      // Why: drop targets refuse workspace-file drags without a resolved source host.
      if (activeWorktreeId) {
        writeWorkspaceFileDragSourceIfResolved(
          event.dataTransfer,
          activeWorktreeId,
          getFileExplorerOperationExecutionHostId(operationOwner),
          operationOwner?.kind === 'runtime' ? operationOwner.environmentId : undefined
        )
      }
      draggingRef.current = true
    },
    [activeWorktreeId, operationOwner, worktreePath]
  )

  const handleDragEndCapture = useCallback(() => {
    draggingRef.current = false
  }, [])

  const isRowDragActive = useCallback(() => draggingRef.current, [])

  return { isRowDragActive, handleDragStartCapture, handleDragEndCapture }
}
