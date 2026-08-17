import { useCallback } from 'react'
import type { FileTreeRenameEvent } from '@pierre/trees'
import { toast } from 'sonner'
import { basename, joinPath } from '@/lib/path'
import { renameFileOnDisk } from '@/lib/rename-file'
import { getFileExplorerOwnerUnresolvedMessage } from './file-explorer-operation-owner'
import { normalizeTreeRelativePath } from './file-explorer-tree-relative-paths'
import type { FileExplorerTreeFileMutation } from './file-explorer-tree-watch-mutations'

type UseFileTreeRenameParams = {
  activeWorktreeId: string | null
  worktreePath: string | null
  refreshFileList: () => void
  applyExternalFileMutations: (mutations: readonly FileExplorerTreeFileMutation[]) => void
  /** Returns true when the commit belonged to a create placeholder. */
  handleCreateCommit: (event: FileTreeRenameEvent) => boolean
}

/** Runs the existing rename runtime flow when the tree's inline rename commits. */
export function useFileTreeRename({
  activeWorktreeId,
  worktreePath,
  refreshFileList,
  applyExternalFileMutations,
  handleCreateCommit
}: UseFileTreeRenameParams): (event: FileTreeRenameEvent) => void {
  return useCallback(
    (event: FileTreeRenameEvent) => {
      if (handleCreateCommit(event)) {
        return
      }
      if (!activeWorktreeId || !worktreePath) {
        return
      }
      const sourceRelative = normalizeTreeRelativePath(event.sourcePath)
      const destinationRelative = normalizeTreeRelativePath(event.destinationPath)
      const newName = basename(destinationRelative)
      void (async () => {
        try {
          await renameFileOnDisk({
            oldPath: joinPath(worktreePath, sourceRelative),
            newName,
            worktreeId: activeWorktreeId,
            worktreePath
          })
        } catch {
          // Why: only the synchronous owner-guard capture can reach here;
          // renameFileOnDisk toasts its own IPC failures.
          toast.error(getFileExplorerOwnerUnresolvedMessage())
        }
        // Why: record the rename in the flat cache immediately (the model has
        // already moved the row), then resync so a failed disk rename restores.
        applyExternalFileMutations([
          {
            kind: 'rename',
            fromRelativePath: sourceRelative,
            toRelativePath: destinationRelative,
            isDirectory: event.isFolder
          }
        ])
        refreshFileList()
      })()
    },
    [
      activeWorktreeId,
      applyExternalFileMutations,
      handleCreateCommit,
      refreshFileList,
      worktreePath
    ]
  )
}
