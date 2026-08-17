import { useCallback } from 'react'
import type { FileTreeDropResult } from '@pierre/trees'
import { toast } from 'sonner'
import { basename, joinPath } from '@/lib/path'
import { extractIpcErrorMessage } from '@/lib/rename-file'
import { executeOpenEditorPathMove } from '@/lib/execute-open-editor-path-move'
import { commitFileExplorerOp } from './fileExplorerUndoRedo'
import { captureFileExplorerOperationGuard } from './file-explorer-operation-owner'
import { normalizeTreeRelativePath } from './file-explorer-tree-relative-paths'
import type { FileExplorerTreeFileMutation } from './file-explorer-tree-watch-mutations'
import type { FileExplorerOperationOwner } from './file-explorer-types'
import type { FileTreeModelLike } from './use-file-explorer-tree-model'

type UseFileTreeDropParams = {
  model: FileTreeModelLike | null
  activeWorktreeId: string | null
  worktreePath: string | null
  operationOwner: FileExplorerOperationOwner | undefined
  refreshFileList: () => void
  applyExternalFileMutations: (mutations: readonly FileExplorerTreeFileMutation[]) => void
}

/**
 * Moves dropped rows on disk after the tree model applied them visually,
 * reverting the model (and toasting) when a disk move fails.
 */
export function useFileTreeDrop({
  model,
  activeWorktreeId,
  worktreePath,
  operationOwner,
  refreshFileList,
  applyExternalFileMutations
}: UseFileTreeDropParams): (event: FileTreeDropResult) => void {
  return useCallback(
    (event: FileTreeDropResult) => {
      if (!model || !activeWorktreeId || !worktreePath) {
        return
      }
      const destinationRelativeDir = event.target.directoryPath
        ? normalizeTreeRelativePath(event.target.directoryPath)
        : ''
      void (async () => {
        for (const draggedPath of event.draggedPaths) {
          const fromRelative = normalizeTreeRelativePath(draggedPath)
          const name = basename(fromRelative)
          const toRelative = destinationRelativeDir ? `${destinationRelativeDir}/${name}` : name
          // Why: the model moved the row already, so directory-ness reads from the destination.
          const isDirectory =
            draggedPath.endsWith('/') || Boolean(model.getItem(toRelative)?.isDirectory())
          if (fromRelative === toRelative) {
            continue
          }
          const fromPath = joinPath(worktreePath, fromRelative)
          const toPath = joinPath(worktreePath, toRelative)
          try {
            const operationGuard = captureFileExplorerOperationGuard(
              activeWorktreeId,
              operationOwner
            )
            const operationRoute = operationGuard.route
            const fileContext = {
              settings: operationRoute.settings,
              worktreeId: activeWorktreeId,
              worktreePath,
              connectionId: operationRoute.connectionId,
              expectedExecutionHostId: operationRoute.expectedExecutionHostId,
              expectedSshTargetId: operationRoute.expectedSshTargetId,
              expectedSshConnectionGeneration: operationRoute.expectedSshConnectionGeneration
            }
            operationGuard.assertCurrent()
            await executeOpenEditorPathMove({
              context: fileContext,
              fromPath,
              toPath,
              worktreeId: activeWorktreeId,
              worktreePath
            })
            commitFileExplorerOp({
              undo: async () => {
                operationGuard.assertCurrent()
                await executeOpenEditorPathMove({
                  context: fileContext,
                  fromPath: toPath,
                  toPath: fromPath,
                  worktreeId: activeWorktreeId,
                  worktreePath
                })
                refreshFileList()
              },
              redo: async () => {
                operationGuard.assertCurrent()
                await executeOpenEditorPathMove({
                  context: fileContext,
                  fromPath,
                  toPath,
                  worktreeId: activeWorktreeId,
                  worktreePath
                })
                refreshFileList()
              }
            })
            // Why: the model already moved the row on drop; only the flat cache
            // needs the move so the next reset agrees with disk.
            applyExternalFileMutations([
              {
                kind: 'rename',
                fromRelativePath: fromRelative,
                toRelativePath: toRelative,
                isDirectory
              }
            ])
          } catch (err) {
            toast.error(extractIpcErrorMessage(err, `Failed to move '${name}'.`))
            // Why: revert the visual move the library applied before the drop callback.
            try {
              model.move(
                isDirectory ? `${toRelative}/` : toRelative,
                isDirectory ? `${fromRelative}/` : fromRelative
              )
            } catch {
              refreshFileList()
            }
          }
        }
      })()
    },
    [
      activeWorktreeId,
      applyExternalFileMutations,
      model,
      operationOwner,
      refreshFileList,
      worktreePath
    ]
  )
}
