import React, { useState } from 'react'
import { Archive } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { translate } from '@/i18n/i18n'
import { getStashScopeLabel, suggestStashName } from '../sync/stash-naming'
import type { PendingStashPush, StashPushSubmission } from '../sync/use-stashes'

function formatFileCount(count: number): string {
  return count === 1
    ? translate('auto.components.right.sidebar.SourceControl.stashFileCountOne', '1 file')
    : translate(
        'auto.components.right.sidebar.SourceControl.stashFileCountOther',
        '{{count}} files',
        {
          count
        }
      )
}

/** Name + scope form for `git stash push`; the scope toggles between the clicked section and everything. */
export function SourceControlStashPushDialog({
  pending,
  branchName,
  isExecuting,
  onCancel,
  onSubmit
}: {
  pending: PendingStashPush | null
  branchName: string
  isExecuting: boolean
  onCancel: () => void
  onSubmit: (submission: StashPushSubmission) => void
}): React.JSX.Element {
  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open && !isExecuting) {
          onCancel()
        }
      }}
    >
      {pending && (
        <StashPushForm
          key={`${pending.area}:${pending.areaPaths.length}`}
          pending={pending}
          branchName={branchName}
          isExecuting={isExecuting}
          onCancel={onCancel}
          onSubmit={onSubmit}
        />
      )}
    </Dialog>
  )
}

function StashPushForm({
  pending,
  branchName,
  isExecuting,
  onCancel,
  onSubmit
}: {
  pending: PendingStashPush
  branchName: string
  isExecuting: boolean
  onCancel: () => void
  onSubmit: (submission: StashPushSubmission) => void
}): React.JSX.Element {
  const [scope, setScope] = useState<StashPushSubmission['scope']>('area')
  const suggested = suggestStashName(scope === 'all' ? 'all' : pending.area, branchName)
  const [message, setMessage] = useState(suggested)
  // Why: track whether the user edited the name so switching scope keeps refreshing the suggestion until they do.
  const [messageEdited, setMessageEdited] = useState(false)
  const areaLabel = getStashScopeLabel(pending.area)
  // Why: "all" can equal the section when it is the only one with changes; the toggle is still shown so the choice is explicit.
  const submit = (): void => {
    if (isExecuting) {
      return
    }
    onSubmit({ message: message.trim() || suggested, scope })
  }
  const changeScope = (next: string): void => {
    if (next !== 'area' && next !== 'all') {
      return
    }
    setScope(next)
    if (!messageEdited) {
      setMessage(suggestStashName(next === 'all' ? 'all' : pending.area, branchName))
    }
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle className="text-sm">
          {translate(
            'auto.components.right.sidebar.SourceControl.stashDialogTitle',
            'Stash changes'
          )}
        </DialogTitle>
        <DialogDescription className="text-xs">
          {translate(
            'auto.components.right.sidebar.SourceControl.stashDialogDescription',
            'Saves the selected changes to the git stash and restores the files to their last commit.'
          )}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="source-control-stash-name" className="text-xs">
            {translate('auto.components.right.sidebar.SourceControl.stashNameLabel', 'Name')}
          </Label>
          <Input
            id="source-control-stash-name"
            autoFocus
            value={message}
            disabled={isExecuting}
            onChange={(event) => {
              setMessage(event.target.value)
              setMessageEdited(true)
            }}
            onFocus={(event) => event.target.select()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">
            {translate('auto.components.right.sidebar.SourceControl.stashScopeLabel', 'Include')}
          </Label>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={scope}
            onValueChange={changeScope}
            className="w-full"
          >
            <ToggleGroupItem value="area" className="flex-1 gap-1.5" disabled={isExecuting}>
              <span className="truncate">{areaLabel}</span>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {formatFileCount(pending.areaPaths.length)}
              </span>
            </ToggleGroupItem>
            <ToggleGroupItem value="all" className="flex-1 gap-1.5" disabled={isExecuting}>
              <span className="truncate">{getStashScopeLabel('all')}</span>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {formatFileCount(pending.allPaths.length)}
              </span>
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" disabled={isExecuting} onClick={onCancel}>
          {translate('auto.components.right.sidebar.SourceControl.05bb8f4a48', 'Cancel')}
        </Button>
        <Button type="button" size="sm" disabled={isExecuting} onClick={submit}>
          <Archive className="size-4" />
          {isExecuting
            ? translate('auto.components.right.sidebar.SourceControl.stashSubmitting', 'Stashing…')
            : translate('auto.components.right.sidebar.SourceControl.stashSubmit', 'Stash')}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
