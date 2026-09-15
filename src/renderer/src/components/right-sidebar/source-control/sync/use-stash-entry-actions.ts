import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { applyRuntimeGitStash, dropRuntimeGitStash } from '@/runtime/runtime-git-client'
import { translate } from '@/i18n/i18n'
import type { GitStashEntry } from '../../../../../../shared/git-stash'
import { describeStashError } from './stash-naming'
import type { SourceControlStashGitContext } from './use-stash-list'

/** Apply and delete for one stash entry, plus the row-click dialog selection they act from. */
export function useSourceControlStashEntryActions({
  gitContext,
  activeWorktreeId,
  refreshActiveGitStatusAfterMutation,
  refreshStashes
}: {
  gitContext: SourceControlStashGitContext
  activeWorktreeId: string | null
  refreshActiveGitStatusAfterMutation: () => Promise<void>
  refreshStashes: () => Promise<void>
}) {
  const [selectedStash, setSelectedStash] = useState<GitStashEntry | null>(null)
  const [isMutatingStash, setIsMutatingStash] = useState(false)

  // Why: reset during render so a worktree switch never paints the previous dialog.
  const [dialogWorktreeId, setDialogWorktreeId] = useState(activeWorktreeId)
  if (dialogWorktreeId !== activeWorktreeId) {
    setDialogWorktreeId(activeWorktreeId)
    setSelectedStash(null)
  }

  const applyStash = useCallback(
    async (stash: GitStashEntry): Promise<void> => {
      const context = gitContext()
      if (!context || isMutatingStash) {
        return
      }
      setSelectedStash(null)
      setIsMutatingStash(true)
      try {
        const result = await applyRuntimeGitStash(context, stash.sha)
        switch (result.status) {
          case 'applied':
            toast.success(
              translate(
                'auto.components.right.sidebar.SourceControl.stashApplied',
                'Applied stash “{{name}}”',
                { name: stash.message }
              )
            )
            break
          case 'conflicts':
            toast.warning(
              translate(
                'auto.components.right.sidebar.SourceControl.stashAppliedConflicts',
                'Applied stash “{{name}}” with conflicts',
                { name: stash.message }
              ),
              {
                description: translate(
                  'auto.components.right.sidebar.SourceControl.stashAppliedConflictsDetail',
                  'Resolve them in the worktree — the stash entry is kept as a backup.'
                )
              }
            )
            break
          case 'failed':
            toast.error(
              translate(
                'auto.components.right.sidebar.SourceControl.stashApplyFailed',
                'Failed to apply stash'
              ),
              { description: result.message }
            )
        }
      } catch (error) {
        console.error('[SourceControl] stash apply failed', error)
        toast.error(
          translate(
            'auto.components.right.sidebar.SourceControl.stashApplyFailed',
            'Failed to apply stash'
          ),
          { description: describeStashError(error) }
        )
      } finally {
        setIsMutatingStash(false)
        await refreshActiveGitStatusAfterMutation()
        void refreshStashes()
      }
    },
    [gitContext, isMutatingStash, refreshActiveGitStatusAfterMutation, refreshStashes]
  )

  const dropStash = useCallback(
    async (stash: GitStashEntry): Promise<void> => {
      const context = gitContext()
      if (!context || isMutatingStash) {
        return
      }
      setSelectedStash(null)
      setIsMutatingStash(true)
      try {
        const result = await dropRuntimeGitStash(context, stash.sha)
        switch (result.status) {
          case 'dropped':
            toast.success(
              translate(
                'auto.components.right.sidebar.SourceControl.stashDeleted',
                'Deleted stash “{{name}}”',
                { name: stash.message }
              )
            )
            break
          case 'not-found':
            toast.info(
              translate(
                'auto.components.right.sidebar.SourceControl.stashGone',
                'That stash no longer exists'
              )
            )
            break
          case 'failed':
            toast.error(
              translate(
                'auto.components.right.sidebar.SourceControl.stashDeleteFailed',
                'Failed to delete stash'
              ),
              { description: result.message }
            )
        }
      } catch (error) {
        console.error('[SourceControl] stash drop failed', error)
        toast.error(
          translate(
            'auto.components.right.sidebar.SourceControl.stashDeleteFailed',
            'Failed to delete stash'
          ),
          { description: describeStashError(error) }
        )
      } finally {
        setIsMutatingStash(false)
        void refreshStashes()
      }
    },
    [gitContext, isMutatingStash, refreshStashes]
  )

  return { applyStash, dropStash, isMutatingStash, selectedStash, setSelectedStash }
}
