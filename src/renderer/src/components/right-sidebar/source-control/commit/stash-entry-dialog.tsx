import React from 'react'
import { ArchiveRestore, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import type { GitStashEntry } from '../../../../../../shared/git-stash'
import { formatGitHistoryTimestamp } from '../sync/git-history-format'

export function describeStashEntry(stash: GitStashEntry): string {
  const when = formatGitHistoryTimestamp(stash.timestamp)
  const branch = stash.branch
  if (branch && when) {
    return translate(
      'auto.components.right.sidebar.SourceControl.stashMetaBranchAndTime',
      'Stashed on {{branch}} · {{when}}',
      { branch, when }
    )
  }
  if (branch) {
    return translate(
      'auto.components.right.sidebar.SourceControl.stashMetaBranch',
      'Stashed on {{branch}}',
      { branch }
    )
  }
  return when
}

/** Apply-or-delete decision for one stash entry, raised by clicking its row. */
export function SourceControlStashEntryDialog({
  stash,
  isMutating,
  onOpenChange,
  onApply,
  onDelete
}: {
  stash: GitStashEntry | null
  isMutating: boolean
  onOpenChange: (open: boolean) => void
  onApply: (stash: GitStashEntry) => void
  onDelete: (stash: GitStashEntry) => void
}): React.JSX.Element {
  return (
    <Dialog
      open={stash !== null}
      onOpenChange={(open) => {
        if (!open && !isMutating) {
          onOpenChange(false)
        }
      }}
    >
      {stash && (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="break-words text-sm">{stash.message}</DialogTitle>
            <DialogDescription className="text-xs">
              {describeStashEntry(stash)}
              {' · '}
              {translate(
                'auto.components.right.sidebar.SourceControl.stashEntryDialogHint',
                'Applying keeps the stash entry; delete it once you no longer need it.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isMutating}
              onClick={() => onDelete(stash)}
            >
              <Trash2 className="size-4" />
              {translate('auto.components.right.sidebar.SourceControl.stashDelete', 'Delete')}
            </Button>
            <Button type="button" size="sm" disabled={isMutating} onClick={() => onApply(stash)}>
              <ArchiveRestore className="size-4" />
              {translate('auto.components.right.sidebar.SourceControl.stashApply', 'Apply')}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
