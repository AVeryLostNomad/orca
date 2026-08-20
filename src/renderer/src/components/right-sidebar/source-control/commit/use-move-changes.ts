import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import {
  notifyEditorExternalFileChange,
  requestEditorSaveQuiesce
} from '@/components/editor/editor-autosave'
import { getConnectionId } from '@/lib/connection-context'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import {
  moveRuntimeGitChangesToWorktree,
  type RuntimeGitContext
} from '@/runtime/runtime-git-client'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { GitStatusEntry } from '../../../../../../shared/git-status-types'

export type MoveChangesTarget = {
  worktreeId: string
  worktreePath: string
  /** Display name for toasts. */
  label: string
}

/** Owns the "Move changes to another worktree" dialog and its execution. */
export function useSourceControlMoveChanges({
  activeRepoSettings,
  activeWorktreeId,
  worktreePath,
  entries,
  unresolvedConflicts,
  isFolder,
  isExecutingBulk,
  setIsExecutingBulk,
  clearSelection,
  refreshActiveGitStatusAfterMutation
}: {
  activeRepoSettings: RuntimeGitContext['settings']
  activeWorktreeId: string | null
  worktreePath: string | null
  entries: GitStatusEntry[]
  unresolvedConflicts: GitStatusEntry[]
  isFolder: boolean
  isExecutingBulk: boolean
  setIsExecutingBulk: (value: boolean) => void
  clearSelection: () => void
  refreshActiveGitStatusAfterMutation: () => Promise<void>
}) {
  const [moveChangesDialogOpen, setMoveChangesDialogOpen] = useState(false)
  // Why: reset during render so a worktree switch never paints the previous dialog.
  const [moveDialogWorktreeId, setMoveDialogWorktreeId] = useState(activeWorktreeId)
  if (moveDialogWorktreeId !== activeWorktreeId) {
    setMoveDialogWorktreeId(activeWorktreeId)
    setMoveChangesDialogOpen(false)
  }

  // Why: the stash transfer needs a real git worktree family and refuses unmerged entries.
  const canMoveChanges =
    !isFolder &&
    entries.length > 0 &&
    unresolvedConflicts.length === 0 &&
    Boolean(worktreePath) &&
    Boolean(activeWorktreeId)

  const requestMoveChanges = useCallback((): void => {
    if (!canMoveChanges || isExecutingBulk) {
      return
    }
    setMoveChangesDialogOpen(true)
  }, [canMoveChanges, isExecutingBulk])

  const executeMoveChanges = useCallback(
    async (target: MoveChangesTarget) => {
      if (!worktreePath || !activeWorktreeId || isExecutingBulk) {
        return
      }
      setMoveChangesDialogOpen(false)
      setIsExecutingBulk(true)
      const paths = entries.map((entry) => entry.path)
      try {
        const runtimeEnvironmentId =
          useAppStore.getState().settings?.activeRuntimeEnvironmentId?.trim() || null
        // Why: quiesce pending editor autosaves first so a delayed save can't recreate the moved edits after git clears the source.
        await Promise.all(
          paths.map((relativePath) =>
            requestEditorSaveQuiesce({
              worktreeId: activeWorktreeId,
              worktreePath,
              relativePath,
              runtimeEnvironmentId
            })
          )
        )
        const connectionId = getConnectionId(activeWorktreeId) ?? undefined
        const result = await moveRuntimeGitChangesToWorktree(
          {
            // Why: route the move by the repo OWNER host, not the focused runtime.
            settings: activeRepoSettings,
            worktreeId: activeWorktreeId,
            worktreePath,
            connectionId
          },
          { worktreeId: target.worktreeId, worktreePath: target.worktreePath }
        )
        for (const relativePath of paths) {
          notifyEditorExternalFileChange({
            worktreeId: activeWorktreeId,
            worktreePath,
            relativePath,
            runtimeEnvironmentId
          })
        }
        switch (result.status) {
          case 'moved':
            toast.success(
              translate(
                'auto.components.right.sidebar.SourceControl.moveChangesMoved',
                'Moved changes to {{value0}}',
                { value0: target.label }
              ),
              {
                action: {
                  label: translate(
                    'auto.components.right.sidebar.SourceControl.moveChangesOpen',
                    'Open'
                  ),
                  onClick: () => activateAndRevealWorktree(target.worktreeId)
                }
              }
            )
            clearSelection()
            break
          case 'conflicts':
            toast.warning(
              translate(
                'auto.components.right.sidebar.SourceControl.moveChangesConflicts',
                'Moved changes to {{value0}} with conflicts',
                { value0: target.label }
              ),
              {
                description: translate(
                  'auto.components.right.sidebar.SourceControl.moveChangesConflictsDetail',
                  'Resolve them there — a backup copy is kept in the git stash.'
                ),
                action: {
                  label: translate(
                    'auto.components.right.sidebar.SourceControl.moveChangesOpen',
                    'Open'
                  ),
                  onClick: () => activateAndRevealWorktree(target.worktreeId)
                }
              }
            )
            clearSelection()
            break
          case 'nothing-to-move':
            toast.info(
              translate(
                'auto.components.right.sidebar.SourceControl.moveChangesNothing',
                'No changes to move'
              )
            )
            break
          case 'blocked':
          case 'failed':
            toast.error(
              translate(
                'auto.components.right.sidebar.SourceControl.moveChangesFailed',
                'Failed to move changes'
              ),
              { description: result.message }
            )
        }
        await refreshActiveGitStatusAfterMutation()
      } catch (error) {
        console.error('[SourceControl] move changes failed', error)
        toast.error(
          translate(
            'auto.components.right.sidebar.SourceControl.moveChangesFailed',
            'Failed to move changes'
          ),
          { description: error instanceof Error ? error.message : undefined }
        )
        // Why: the transfer may have partially advanced before the error; re-read rather than trust the cached status.
        await refreshActiveGitStatusAfterMutation()
      } finally {
        setIsExecutingBulk(false)
      }
    },
    [
      activeRepoSettings,
      activeWorktreeId,
      clearSelection,
      entries,
      isExecutingBulk,
      refreshActiveGitStatusAfterMutation,
      setIsExecutingBulk,
      worktreePath
    ]
  )

  return {
    canMoveChanges,
    moveChangesDialogOpen,
    setMoveChangesDialogOpen,
    requestMoveChanges,
    executeMoveChanges
  }
}
