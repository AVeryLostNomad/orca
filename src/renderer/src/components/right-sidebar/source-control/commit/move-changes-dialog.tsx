import React, { useCallback, useMemo, useState } from 'react'
import { FolderPlus, GitBranch } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { getWorktreeGitIdentityDisplay } from '@/lib/worktree-git-identity-display'
import {
  formatWorkspaceCreateError,
  getWorkspaceCreateErrorToastMessage
} from '@/lib/workspace-create-error-format'
import { useAppStore } from '@/store'
import type { MoveChangesTarget } from './use-move-changes'

/**
 * Picker for the "Move changes to another worktree" flow: choose an existing
 * worktree of the same repo, or create a fresh one (based on the source
 * branch, so the stash applies cleanly) and move into it.
 */
export function SourceControlMoveChangesDialog({
  open,
  onOpenChange,
  repoId,
  currentWorktreeId,
  sourceBranchName,
  onSelectTarget
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  repoId: string
  currentWorktreeId: string | null
  sourceBranchName: string
  onSelectTarget: (target: MoveChangesTarget) => void
}): React.JSX.Element {
  const [mode, setMode] = useState<'pick' | 'create'>('pick')
  const [newWorktreeName, setNewWorktreeName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const worktrees = useAppStore((s) => s.worktreesByRepo[repoId])
  const createWorktree = useAppStore((s) => s.createWorktree)

  const candidates = useMemo(
    () =>
      (worktrees ?? [])
        .filter(
          (worktree) =>
            worktree.id !== currentWorktreeId && !worktree.isArchived && Boolean(worktree.path)
        )
        .sort((a, b) => b.lastActivityAt - a.lastActivityAt),
    [worktrees, currentWorktreeId]
  )

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setMode('pick')
        setNewWorktreeName('')
      }
      // Why: closing mid-create would orphan the move half of create-and-move.
      if (!isCreating) {
        onOpenChange(nextOpen)
      }
    },
    [isCreating, onOpenChange]
  )

  const handleCreateAndMove = useCallback(async () => {
    const name = newWorktreeName.trim()
    if (!name || isCreating) {
      return
    }
    setIsCreating(true)
    try {
      // Why: base the new worktree on the source branch so it shares the source
      // HEAD and the moved changes apply without conflicts.
      const result = await createWorktree(repoId, name, sourceBranchName || undefined)
      setMode('pick')
      setNewWorktreeName('')
      onSelectTarget({
        worktreeId: result.worktree.id,
        worktreePath: result.worktree.path,
        label: result.worktree.displayName || name
      })
    } catch (error) {
      toast.error(getWorkspaceCreateErrorToastMessage(formatWorkspaceCreateError(error)))
    } finally {
      setIsCreating(false)
    }
  }, [createWorktree, isCreating, newWorktreeName, onSelectTarget, repoId, sourceBranchName])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.right.sidebar.SourceControl.moveChangesTitle',
              'Move changes to worktree'
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.right.sidebar.SourceControl.moveChangesDescription',
              'Moves all uncommitted changes — staged, unstaged and untracked — into the selected worktree.'
            )}
          </DialogDescription>
        </DialogHeader>
        {mode === 'pick' ? (
          <Command className="rounded-md border border-border">
            <CommandInput
              placeholder={translate(
                'auto.components.right.sidebar.SourceControl.moveChangesSearch',
                'Search worktrees…'
              )}
            />
            <CommandList className="max-h-64">
              <CommandEmpty>
                {translate(
                  'auto.components.right.sidebar.SourceControl.moveChangesEmpty',
                  'No other worktrees in this repo.'
                )}
              </CommandEmpty>
              {candidates.length > 0 && (
                <CommandGroup>
                  {candidates.map((worktree) => {
                    const identity = getWorktreeGitIdentityDisplay(worktree)
                    return (
                      <CommandItem
                        key={worktree.id}
                        value={`${worktree.displayName} ${identity?.kind === 'branch' ? identity.branchName : ''}`}
                        onSelect={() =>
                          onSelectTarget({
                            worktreeId: worktree.id,
                            worktreePath: worktree.path,
                            label: worktree.displayName
                          })
                        }
                      >
                        <GitBranch className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{worktree.displayName}</span>
                        {identity?.kind === 'branch' && (
                          <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">
                            {identity.branchName}
                          </span>
                        )}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )}
              <CommandSeparator />
              <CommandGroup>
                <CommandItem onSelect={() => setMode('create')}>
                  <FolderPlus className="size-4 shrink-0 text-muted-foreground" />
                  <span>
                    {translate(
                      'auto.components.right.sidebar.SourceControl.moveChangesCreateNew',
                      'Create new worktree…'
                    )}
                  </span>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        ) : (
          <div className="flex flex-col gap-3">
            <Input
              autoFocus
              value={newWorktreeName}
              onChange={(event) => setNewWorktreeName(event.target.value)}
              placeholder={translate(
                'auto.components.right.sidebar.SourceControl.moveChangesNamePlaceholder',
                'New worktree name'
              )}
              disabled={isCreating}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleCreateAndMove()
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isCreating}
                onClick={() => setMode('pick')}
              >
                {translate('auto.components.right.sidebar.SourceControl.moveChangesBack', 'Back')}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={isCreating || !newWorktreeName.trim()}
                onClick={() => void handleCreateAndMove()}
              >
                {isCreating
                  ? translate(
                      'auto.components.right.sidebar.SourceControl.moveChangesCreating',
                      'Creating…'
                    )
                  : translate(
                      'auto.components.right.sidebar.SourceControl.moveChangesCreateAndMove',
                      'Create & Move'
                    )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
