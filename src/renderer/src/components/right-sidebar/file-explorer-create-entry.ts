import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { detectLanguage } from '@/lib/language-detect'
import { basename } from '@/lib/path'
import { extractIpcErrorMessage } from '@/lib/rename-file'
import { createRuntimePath, deleteRuntimePath } from '@/runtime/runtime-file-client'
import { commitFileExplorerOp } from './fileExplorerUndoRedo'
import type { FileExplorerOperationOwner } from './file-explorer-types'
import { captureFileExplorerOperationGuard } from './file-explorer-operation-owner'

type CreateExplorerEntryArgs = {
  worktreeId: string
  worktreePath: string
  /** Absolute path of the entry to create. */
  fullPath: string
  relativePath: string
  kind: 'file' | 'folder'
  operationOwner?: FileExplorerOperationOwner
  /** Resync hook run after undo/redo replays. */
  refresh: () => void
}

/**
 * Create a file or folder on disk with the explorer's undo/redo pair, opening
 * new files in the editor. Returns whether the disk operation succeeded.
 */
export async function createExplorerEntryOnDisk({
  worktreeId,
  worktreePath,
  fullPath,
  relativePath,
  kind,
  operationOwner,
  refresh
}: CreateExplorerEntryArgs): Promise<boolean> {
  const name = basename(relativePath)
  try {
    const operationGuard = captureFileExplorerOperationGuard(worktreeId, operationOwner)
    const operationRoute = operationGuard.route
    const fileContext = {
      settings: operationRoute.settings,
      worktreeId,
      worktreePath,
      connectionId: operationRoute.connectionId,
      expectedExecutionHostId: operationRoute.expectedExecutionHostId,
      expectedSshTargetId: operationRoute.expectedSshTargetId,
      expectedSshConnectionGeneration: operationRoute.expectedSshConnectionGeneration
    }
    operationGuard.assertCurrent()
    const entryType = kind === 'folder' ? 'directory' : 'file'
    await createRuntimePath(fileContext, fullPath, entryType)
    commitFileExplorerOp({
      undo: async () => {
        const currentRoute = operationGuard.assertCurrent()
        await deleteRuntimePath(
          {
            ...fileContext,
            settings: currentRoute.settings,
            connectionId: currentRoute.connectionId
          },
          fullPath,
          kind === 'folder'
        )
        refresh()
      },
      redo: async () => {
        const currentRoute = operationGuard.assertCurrent()
        await createRuntimePath(
          {
            ...fileContext,
            settings: currentRoute.settings,
            connectionId: currentRoute.connectionId
          },
          fullPath,
          entryType
        )
        refresh()
      }
    })
    if (kind === 'file') {
      const runtimeEnvironmentId = fileContext.settings.activeRuntimeEnvironmentId?.trim() || null
      useAppStore.getState().openFile(
        {
          filePath: fullPath,
          relativePath,
          worktreeId,
          runtimeEnvironmentId: runtimeEnvironmentId ?? undefined,
          language: detectLanguage(name),
          mode: 'edit'
        },
        { suppressActiveRuntimeFallback: runtimeEnvironmentId === null }
      )
    }
    return true
  } catch (err) {
    toast.error(extractIpcErrorMessage(err, `Failed to create '${name}'.`))
    return false
  }
}
