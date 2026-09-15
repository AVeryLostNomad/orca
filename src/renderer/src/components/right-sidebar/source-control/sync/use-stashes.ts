import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { notifyEditorExternalFileChange } from '@/components/editor/editor-autosave'
import { getConnectionId } from '@/lib/connection-context'
import { pushRuntimeGitStash, type RuntimeGitContext } from '@/runtime/runtime-git-client'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { GitStatusEntry } from '../../../../../../shared/git-status-types'
import type { GitStashPushScope } from '../../../../../../shared/git-stash'
import type { SourceControlEntryGroups, SourceControlSectionArea } from '../listing/section-order'
import { describeStashError, suggestStashName } from './stash-naming'
import { useSourceControlStashEntryActions } from './use-stash-entry-actions'
import { useSourceControlStashList, type SourceControlStashGitContext } from './use-stash-list'

export type { SourceControlStashListState } from './use-stash-list'

/** The "Stash changes" dialog: which area was clicked and what "all" would cover. */
export type PendingStashPush = {
  area: SourceControlSectionArea
  areaPaths: readonly string[]
  allPaths: readonly string[]
}

export type StashPushSubmission = { message: string; scope: 'area' | 'all' }

/** Owns the stash list for the active worktree plus the push/apply/drop flows and their dialogs. */
export function useSourceControlStashes({
  activeRepoSettings,
  activeWorktreeId,
  worktreePath,
  branchName,
  entries,
  grouped,
  isFolder,
  isBranchVisible,
  isExecutingBulk,
  setIsExecutingBulk,
  clearSelection,
  refreshActiveGitStatusAfterMutation,
  worktreeMap
}: {
  activeRepoSettings: RuntimeGitContext['settings']
  activeWorktreeId: string | null
  worktreePath: string | null
  branchName: string
  entries: GitStatusEntry[]
  grouped: SourceControlEntryGroups
  isFolder: boolean
  isBranchVisible: boolean
  isExecutingBulk: boolean
  setIsExecutingBulk: (value: boolean) => void
  clearSelection: () => void
  refreshActiveGitStatusAfterMutation: () => Promise<void>
  worktreeMap: ReadonlyMap<string, unknown>
}) {
  const [pendingStashPush, setPendingStashPush] = useState<PendingStashPush | null>(null)
  // Why: reset during render so a worktree switch never paints the previous dialog.
  const [dialogWorktreeId, setDialogWorktreeId] = useState(activeWorktreeId)
  if (dialogWorktreeId !== activeWorktreeId) {
    setDialogWorktreeId(activeWorktreeId)
    setPendingStashPush(null)
  }

  const canStash = !isFolder && Boolean(worktreePath) && Boolean(activeWorktreeId)
  // Why: the reads are routed by owner host, so track it as a stable string — a new settings object alone must not refetch.
  const ownerHostKey = activeRepoSettings?.activeRuntimeEnvironmentId?.trim() ?? ''

  const gitContext = useCallback<SourceControlStashGitContext>(() => {
    if (!activeWorktreeId || !worktreePath) {
      return null
    }
    return {
      // Why: route stash operations by the repo OWNER host, not the focused runtime.
      settings: activeRepoSettings,
      worktreeId: activeWorktreeId,
      worktreePath,
      connectionId: getConnectionId(activeWorktreeId) ?? undefined
    }
  }, [activeRepoSettings, activeWorktreeId, worktreePath])

  const list = useSourceControlStashList({
    gitContext,
    canStash,
    isBranchVisible,
    activeWorktreeId,
    worktreePath,
    entries,
    ownerHostKey,
    worktreeMap
  })
  const entryActions = useSourceControlStashEntryActions({
    gitContext,
    activeWorktreeId,
    refreshActiveGitStatusAfterMutation,
    refreshStashes: list.refreshStashes
  })

  const requestStashArea = useCallback(
    (area: SourceControlSectionArea): void => {
      if (!canStash || isExecutingBulk) {
        return
      }
      const areaPaths = grouped[area].map((entry) => entry.path)
      if (areaPaths.length === 0) {
        return
      }
      setPendingStashPush({ area, areaPaths, allPaths: entries.map((entry) => entry.path) })
    },
    [canStash, entries, grouped, isExecutingBulk]
  )

  const cancelPendingStashPush = useCallback(() => setPendingStashPush(null), [])

  const executeStashPush = useCallback(
    async (submission: StashPushSubmission): Promise<void> => {
      const context = gitContext()
      if (!context || !pendingStashPush || isExecutingBulk) {
        return
      }
      const scope: GitStashPushScope = submission.scope === 'all' ? 'all' : pendingStashPush.area
      const paths =
        submission.scope === 'all' ? pendingStashPush.allPaths : pendingStashPush.areaPaths
      const message = submission.message.trim() || suggestStashName(scope, branchName)
      setPendingStashPush(null)
      setIsExecutingBulk(true)
      try {
        const runtimeEnvironmentId =
          useAppStore.getState().settings?.activeRuntimeEnvironmentId?.trim() || null
        const result = await pushRuntimeGitStash(context, {
          message,
          scope,
          paths: scope === 'all' ? undefined : [...paths]
        })
        // Why: the stash rewrote files under open editors; let them reload from disk.
        for (const relativePath of paths) {
          notifyEditorExternalFileChange({
            worktreeId: context.worktreeId,
            worktreePath: context.worktreePath,
            relativePath,
            runtimeEnvironmentId
          })
        }
        switch (result.status) {
          case 'stashed':
            toast.success(
              translate(
                'auto.components.right.sidebar.SourceControl.stashCreated',
                'Stashed “{{name}}”',
                { name: message }
              )
            )
            clearSelection()
            break
          case 'nothing-to-stash':
            toast.info(
              translate(
                'auto.components.right.sidebar.SourceControl.stashNothing',
                'No changes to stash'
              )
            )
            break
          case 'failed':
            toast.error(
              translate(
                'auto.components.right.sidebar.SourceControl.stashFailed',
                'Failed to stash changes'
              ),
              { description: result.message }
            )
        }
      } catch (error) {
        console.error('[SourceControl] stash push failed', error)
        toast.error(
          translate(
            'auto.components.right.sidebar.SourceControl.stashFailed',
            'Failed to stash changes'
          ),
          { description: describeStashError(error) }
        )
      } finally {
        setIsExecutingBulk(false)
        await refreshActiveGitStatusAfterMutation()
        void list.refreshStashesRef.current()
      }
    },
    [
      branchName,
      clearSelection,
      gitContext,
      isExecutingBulk,
      list.refreshStashesRef,
      pendingStashPush,
      refreshActiveGitStatusAfterMutation,
      setIsExecutingBulk
    ]
  )

  return {
    ...list,
    ...entryActions,
    canStash,
    cancelPendingStashPush,
    executeStashPush,
    pendingStashPush,
    requestStashArea
  }
}
