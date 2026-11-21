import React, { useEffect, useId, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { CreateFromPicker } from '@/components/repo/CreateFromPicker'
import { useAppStore } from '@/store'
import { useAllWorktrees } from '@/store/selectors'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { getRuntimeRepoBaseRefDefault } from '@/runtime/runtime-repo-client'
import { resolveWorktreeDisplayName } from '@/lib/worktree-default-display-name'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import { toWorktreeRemovalTarget } from '../../../../shared/worktree/removal'
import type { WorktreeMergeMode } from '../../../../shared/worktree-merge-types'
import { runWorktreeDeleteWithToast } from './run-worktree-delete-with-toast'
import { blockRemovalForUnsavedFiles } from './removal-unsaved-files'

/** Land a worktree's branch on a target branch, then remove the worktree unless the user keeps it. */
const MergeWorktreeDialog = React.memo(function MergeWorktreeDialog() {
  const checkboxId = useId()
  const activeModal = useAppStore((s) => s.activeModal)
  const modalData = useAppStore((s) => s.modalData)
  const closeModal = useAppStore((s) => s.closeModal)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const keepPreference = useAppStore((s) => s.settings?.keepWorktreeAfterMerge === true)
  const repos = useAppStore((s) => s.repos)
  const allWorktrees = useAllWorktrees()

  const isOpen = activeModal === 'merge-worktree'
  const worktreeId = typeof modalData.worktreeId === 'string' ? modalData.worktreeId : ''
  const worktree = allWorktrees.find((w) => w.id === worktreeId)
  const repoMap = useMemo(() => new Map(repos.map((repo) => [repo.id, repo])), [repos])
  const repo = worktree ? repoMap.get(worktree.repoId) : undefined
  const repoWorktrees = useMemo(
    () => (worktree ? allWorktrees.filter((w) => w.repoId === worktree.repoId) : []),
    [allWorktrees, worktree]
  )

  const [mode, setMode] = useState<WorktreeMergeMode>(
    modalData.mode === 'rebase' ? 'rebase' : 'merge'
  )
  const [targetRef, setTargetRef] = useState(worktree?.baseRef ?? '')
  const [keepWorktree, setKeepWorktree] = useState(keepPreference)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fall back to the project's default base when the worktree never recorded one.
  useEffect(() => {
    if (targetRef || !repo) {
      return
    }
    let cancelled = false
    void getRuntimeRepoBaseRefDefault(getRepoExecutionHostId(repo), repo.id)
      .then((result) => {
        if (!cancelled && result.defaultBaseRef) {
          setTargetRef((current) => current || result.defaultBaseRef || '')
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [repo, targetRef])

  if (!worktree || !repo) {
    return null
  }

  const sourceBranch = worktree.branch.replace(/^refs\/heads\//, '')
  const worktreeName = resolveWorktreeDisplayName(worktree)

  const handleConfirm = async (): Promise<void> => {
    if (!targetRef || busy) {
      return
    }
    // Why: removal would close editors with unsaved edits; refuse before touching any branch.
    if (
      !keepWorktree &&
      blockRemovalForUnsavedFiles(
        useAppStore.getState,
        [{ id: worktree.id, hostId: worktree.hostId ?? undefined }],
        worktreeName
      )
    ) {
      return
    }
    setBusy(true)
    setError(null)
    if (keepWorktree !== keepPreference) {
      void updateSettings({ keepWorktreeAfterMerge: keepWorktree })
    }
    try {
      const result = await window.api.git.mergeWorktreeIntoTarget({
        worktreePath: worktree.path,
        targetRef,
        mode
      })
      toast.success(
        translate(
          'auto.components.sidebar.MergeWorktreeDialog.merged',
          'Merged {{value0}} into {{value1}}',
          {
            value0: result.sourceBranch,
            value1: result.targetBranch
          }
        )
      )
      closeModal()
      if (!keepWorktree) {
        // The user asked for removal explicitly: skip the delete confirmation and don't let running terminals block it.
        void runWorktreeDeleteWithToast(toWorktreeRemovalTarget(worktree), worktreeName, {
          allowUnverifiedPtyStop: true
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const modeButton = (value: WorktreeMergeMode, label: string): React.JSX.Element => (
    <Button
      type="button"
      size="sm"
      variant={mode === value ? 'default' : 'outline'}
      className="flex-1"
      disabled={busy}
      aria-pressed={mode === value}
      onClick={() => setMode(value)}
    >
      {label}
    </Button>
  )

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !busy) {
          closeModal()
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {mode === 'merge'
              ? translate(
                  'auto.components.sidebar.MergeWorktreeDialog.mergeTitle',
                  'Merge {{value0}} into…',
                  { value0: sourceBranch }
                )
              : translate(
                  'auto.components.sidebar.MergeWorktreeDialog.rebaseTitle',
                  'Rebase {{value0}} onto…',
                  { value0: sourceBranch }
                )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {mode === 'merge'
              ? translate(
                  'auto.components.sidebar.MergeWorktreeDialog.mergeDescription',
                  'Merges this branch into the target branch locally. Nothing is pushed.'
                )
              : translate(
                  'auto.components.sidebar.MergeWorktreeDialog.rebaseDescription',
                  'Rebases this branch onto the target, then fast-forwards the target to it. Nothing is pushed.'
                )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          {modeButton(
            'merge',
            translate('auto.components.sidebar.MergeWorktreeDialog.merge', 'Merge')
          )}
          {modeButton(
            'rebase',
            translate('auto.components.sidebar.MergeWorktreeDialog.rebase', 'Rebase')
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            {translate('auto.components.sidebar.MergeWorktreeDialog.targetBranch', 'Target branch')}
          </span>
          <CreateFromPicker
            repoId={repo.id}
            repoMap={repoMap}
            worktrees={repoWorktrees}
            value={targetRef}
            readOnly={busy}
            onValueChange={setTargetRef}
          />
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id={checkboxId}
            checked={keepWorktree}
            disabled={busy}
            onCheckedChange={(checked) => setKeepWorktree(checked === true)}
          />
          <Label htmlFor={checkboxId} className="text-xs font-normal text-muted-foreground">
            {translate(
              'auto.components.sidebar.MergeWorktreeDialog.keepWorktree',
              'Keep worktree after merging'
            )}
          </Label>
        </div>

        {error ? (
          <p
            role="alert"
            className="scrollbar-sleek max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
          >
            {error}
          </p>
        ) : null}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={closeModal}>
            {translate('auto.components.sidebar.MergeWorktreeDialog.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!targetRef || busy}
            onClick={() => void handleConfirm()}
          >
            {busy ? <Loader2 className={cn('size-3.5 animate-spin')} /> : null}
            {keepWorktree
              ? mode === 'merge'
                ? translate('auto.components.sidebar.MergeWorktreeDialog.confirmMerge', 'Merge')
                : translate('auto.components.sidebar.MergeWorktreeDialog.confirmRebase', 'Rebase')
              : mode === 'merge'
                ? translate(
                    'auto.components.sidebar.MergeWorktreeDialog.confirmMergeAndRemove',
                    'Merge & remove worktree'
                  )
                : translate(
                    'auto.components.sidebar.MergeWorktreeDialog.confirmRebaseAndRemove',
                    'Rebase & remove worktree'
                  )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})

export default MergeWorktreeDialog
