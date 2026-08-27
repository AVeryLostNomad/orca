import { useState } from 'react'
import { FolderInput } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { detectLanguage } from '@/lib/language-detect'
import { getConnectionId } from '@/lib/connection-context'
import { isPathInsideWorktree, toWorktreeRelativePath } from '@/lib/terminal-links'
import { captureWorktreeSshMutationExpectation } from '@/lib/ssh-mutation-expectation'
import { getEditorFileDropOperationContext } from '@/lib/external-file-open'
import {
  importExternalPathsToRuntime,
  type RuntimeFileOperationArgs
} from '@/runtime/runtime-file-client'

/**
 * Copies a file that lives outside the workspace root (OS "open with", drops)
 * into the workspace, reopens the copy, and closes the external tab.
 */
export function EditorPanelCopyIntoWorkspaceButton({
  activeFile
}: {
  activeFile: OpenFile
}): React.JSX.Element | null {
  const worktreePath = useAppStore(
    (s) => s.getKnownWorktreeById?.(activeFile.worktreeId)?.path ?? null
  )
  const [copying, setCopying] = useState(false)

  const isPlainEditableFile =
    activeFile.mode === 'edit' &&
    !activeFile.isUntitled &&
    !activeFile.isScratch &&
    !activeFile.readOnly &&
    !activeFile.checkRunDetails &&
    !activeFile.workspaceNotesOwnerId
  if (
    !isPlainEditableFile ||
    !worktreePath ||
    isPathInsideWorktree(activeFile.filePath, worktreePath)
  ) {
    return null
  }

  const disabled = copying || activeFile.isDirty
  const label = translate(
    'auto.components.editor.EditorPanelCopyIntoWorkspaceButton.copy',
    'Copy into workspace'
  )

  const copyIntoWorkspace = async (): Promise<void> => {
    const store = useAppStore.getState()
    let fileContext: RuntimeFileOperationArgs
    try {
      fileContext = {
        ...getEditorFileDropOperationContext(
          store,
          activeFile.worktreeId,
          worktreePath,
          getConnectionId(activeFile.worktreeId) ?? undefined
        ),
        ...captureWorktreeSshMutationExpectation(store, activeFile.worktreeId)
      }
    } catch {
      toast.error(
        translate(
          'auto.hooks.useGlobalFileDrop.ownerChanged',
          "Couldn't verify which host owns this workspace. Try again after it reconnects."
        )
      )
      return
    }
    setCopying(true)
    try {
      // Why: the importer never overwrites — a name collision yields a renamed copy.
      const { results } = await importExternalPathsToRuntime(
        fileContext,
        [activeFile.filePath],
        worktreePath
      )
      const result = results[0]
      if (result?.status !== 'imported') {
        toast.error(
          translate(
            'auto.components.editor.EditorPanelCopyIntoWorkspaceButton.failed',
            'Could not copy the file into the workspace.'
          )
        )
        return
      }
      store.openFile({
        filePath: result.destPath,
        relativePath: toWorktreeRelativePath(result.destPath, worktreePath) ?? result.destPath,
        worktreeId: activeFile.worktreeId,
        language: detectLanguage(result.destPath),
        mode: 'edit'
      })
      store.closeFile(activeFile.id)
    } catch {
      toast.error(
        translate(
          'auto.components.editor.EditorPanelCopyIntoWorkspaceButton.failed',
          'Could not copy the file into the workspace.'
        )
      )
    } finally {
      setCopying(false)
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
            onClick={() => void copyIntoWorkspace()}
            aria-label={label}
            disabled={disabled}
          >
            <FolderInput size={14} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          {activeFile.isDirty
            ? translate(
                'auto.components.editor.EditorPanelCopyIntoWorkspaceButton.saveFirst',
                'Save the file before copying it into the workspace'
              )
            : label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
