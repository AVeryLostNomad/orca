import { useCallback } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { extractIpcErrorMessage } from '@/lib/ipc-error'
import { getRelativePathInsideRoot } from '@/lib/path'
import { importExternalPathsToRuntime } from '@/runtime/runtime-file-import-client'
import { captureFileExplorerOperationGuard } from './file-explorer-operation-owner'
import { toastFileExplorerImportProblems } from './file-explorer-import-result-toasts'
import { resolveFileExplorerPasteDestination } from './file-explorer-paste-destination'
import type { FileExplorerOperationOwner } from './file-explorer-types'

type UseFileExplorerPasteParams = {
  activeWorktreeId: string | null
  worktreePath: string | null
  operationOwner: FileExplorerOperationOwner | undefined
  refreshDir: (dirPath: string) => Promise<void>
  applySelectedPaths: (absolutePaths: Set<string>) => void
}

/**
 * Paste the files on the OS clipboard (the explorer's Copy, or a file manager copy) into a
 * folder of this workspace. Sources are local paths, so the shared import pipeline copies
 * folders recursively, names collisions like Duplicate, and uploads to remote workspaces.
 */
export function useFileExplorerPaste({
  activeWorktreeId,
  worktreePath,
  operationOwner,
  refreshDir,
  applySelectedPaths
}: UseFileExplorerPasteParams): (targetDir: string) => void {
  return useCallback(
    (targetDir: string) => {
      if (!activeWorktreeId || !worktreePath) {
        return
      }
      const run = async (): Promise<void> => {
        try {
          const sourcePaths = await window.api.ui.readClipboardFilePaths()
          if (sourcePaths.length === 0) {
            toast.info(
              translate(
                'auto.components.right.sidebar.FileExplorerRow.pasteNothingCopied',
                'Nothing to paste. Copy a file or folder first.'
              )
            )
            return
          }
          const destinationDir = resolveFileExplorerPasteDestination(sourcePaths, targetDir)
          if (!destinationDir) {
            toast.error(
              translate(
                'auto.components.right.sidebar.FileExplorerRow.pasteIntoItself',
                'Cannot paste a folder into itself.'
              )
            )
            return
          }
          const guard = captureFileExplorerOperationGuard(activeWorktreeId, operationOwner)
          const { results } = await importExternalPathsToRuntime(
            {
              target: guard.route.target,
              worktreeId: activeWorktreeId,
              worktreePath,
              connectionId: guard.route.connectionId,
              expectedExecutionHostId: guard.route.expectedExecutionHostId,
              expectedSshTargetId: guard.route.expectedSshTargetId,
              expectedSshConnectionGeneration: guard.route.expectedSshConnectionGeneration
            },
            sourcePaths,
            destinationDir,
            { assertCurrent: guard.assertCurrent }
          )
          // Refresh failures must not report an already-successful paste as failed.
          try {
            await refreshDir(destinationDir)
          } catch {}
          const firstPasted = results.find((result) => result.status === 'imported')
          if (
            firstPasted &&
            useAppStore.getState().activeWorktreeId === activeWorktreeId &&
            getRelativePathInsideRoot(firstPasted.destPath, worktreePath) !== null
          ) {
            applySelectedPaths(new Set([firstPasted.destPath]))
          }
          toastFileExplorerImportProblems(results)
        } catch (error) {
          toast.error(
            extractIpcErrorMessage(
              error,
              translate(
                'auto.components.right.sidebar.FileExplorerRow.pasteFailed',
                'Could not paste the copied files.'
              )
            )
          )
        }
      }
      void run()
    },
    [activeWorktreeId, applySelectedPaths, operationOwner, refreshDir, worktreePath]
  )
}
