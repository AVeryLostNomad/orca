import React, { useCallback, useRef, useState } from 'react'
import { ArchiveRestore, ChevronDown, RefreshCw, Trash2 } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { GitBranchChangeEntry } from '../../../../../../shared/git-diff-compare-types'
import type { GitStashEntry } from '../../../../../../shared/git-stash'
import { describeStashEntry } from '../commit/stash-entry-dialog'
import {
  GitHistoryCommitFiles,
  type GitHistoryCommitFilesState
} from '../sync/git-history-commit-files'
import type { SourceControlStashListState } from '../sync/use-stashes'
import { ActionButton } from './action-button'
import { SectionHeader } from './section-header'

type StashRowProps = React.HTMLAttributes<HTMLDivElement> & {
  stash: GitStashEntry
  expanded: boolean
  fileCount: number | null
  onToggleExpand: (stash: GitStashEntry) => void
  onOpenStash: (stash: GitStashEntry) => void
}

// Why: forwardRef + prop spread so ContextMenuTrigger asChild can attach its handlers.
const StashRow = React.forwardRef<HTMLDivElement, StashRowProps>(function StashRow(
  { stash, expanded, fileCount, onToggleExpand, onOpenStash, className, ...rootProps },
  ref
): React.JSX.Element {
  const meta = describeStashEntry(stash)
  return (
    <div
      {...rootProps}
      ref={ref}
      className={cn(
        'group flex min-h-[26px] w-full min-w-0 items-center gap-1 pl-3 pr-3 text-xs transition-colors hover:bg-accent/40',
        className
      )}
      data-testid="source-control-stash-row"
    >
      <button
        type="button"
        className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-expanded={expanded}
        aria-label={
          expanded
            ? translate(
                'auto.components.right.sidebar.SourceControl.stashHideFiles',
                'Hide files in stash {{name}}',
                { name: stash.message }
              )
            : translate(
                'auto.components.right.sidebar.SourceControl.stashShowFiles',
                'Show files in stash {{name}}',
                { name: stash.message }
              )
        }
        onClick={(event) => {
          event.stopPropagation()
          onToggleExpand(stash)
        }}
      >
        <ChevronDown
          aria-hidden="true"
          className={cn('size-3 shrink-0 transition-transform', !expanded && '-rotate-90')}
        />
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-0.5 text-left"
            onClick={() => onOpenStash(stash)}
          >
            <span className="min-w-0 flex-1 truncate text-foreground">{stash.message}</span>
            {fileCount !== null && (
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {fileCount}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6} className="max-w-72">
          <div className="break-words">{stash.message}</div>
          {meta && <div className="text-muted-foreground">{meta}</div>}
        </TooltipContent>
      </Tooltip>
    </div>
  )
})

/** Stash entries for the active worktree; rows expand to their files and open the apply/delete dialog. */
export function SourceControlStashSection({
  state,
  stashes,
  collapsedSections,
  toggleSection,
  onRefresh,
  onLoadStashFiles,
  onSelectStash,
  onApplyStash,
  onDeleteStash
}: {
  state: SourceControlStashListState
  stashes: readonly GitStashEntry[]
  collapsedSections: Set<string>
  toggleSection: (section: string) => void
  onRefresh: () => void
  onLoadStashFiles: (stash: GitStashEntry) => Promise<GitBranchChangeEntry[]>
  onSelectStash: (stash: GitStashEntry) => void
  onApplyStash: (stash: GitStashEntry) => void
  onDeleteStash: (stash: GitStashEntry) => void
}): React.JSX.Element {
  const isCollapsed = collapsedSections.has('stashes')
  const loading = state.status === 'loading' || state.status === 'refreshing'
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [filesBySha, setFilesBySha] = useState<Record<string, GitHistoryCommitFilesState>>({})
  // Why: a stash commit is immutable, so a loaded file list stays valid until the entry disappears.
  const loadedShasRef = useRef<Set<string>>(new Set())

  const handleToggleExpand = useCallback(
    (stash: GitStashEntry): void => {
      const { sha } = stash
      const willExpand = !expanded.has(sha)
      setExpanded((prev) => {
        const next = new Set(prev)
        if (willExpand) {
          next.add(sha)
        } else {
          next.delete(sha)
        }
        return next
      })
      if (!willExpand || loadedShasRef.current.has(sha)) {
        return
      }
      loadedShasRef.current.add(sha)
      setFilesBySha((prev) => ({ ...prev, [sha]: { status: 'loading' } }))
      onLoadStashFiles(stash)
        .then((entries) => {
          setFilesBySha((prev) => ({
            ...prev,
            [sha]: { status: 'ready', entries }
          }))
        })
        .catch((error: unknown) => {
          loadedShasRef.current.delete(sha)
          setFilesBySha((prev) => ({
            ...prev,
            [sha]: {
              status: 'error',
              error:
                error instanceof Error
                  ? error.message
                  : translate(
                      'auto.components.right.sidebar.SourceControl.stashFilesFailed',
                      'Failed to load stash files'
                    )
            }
          }))
        })
    },
    [expanded, onLoadStashFiles]
  )

  return (
    <div>
      <SectionHeader
        label={translate('auto.components.right.sidebar.SourceControl.stashesSection', 'Stashes')}
        count={stashes.length}
        isCollapsed={isCollapsed}
        onToggle={() => toggleSection('stashes')}
        actions={
          <div className="flex items-center can-hover:opacity-0 transition-opacity group-hover/section:opacity-100 focus-within:opacity-100">
            <ActionButton
              icon={loading ? SpinningRefreshIcon : RefreshCw}
              title={translate(
                'auto.components.right.sidebar.SourceControl.stashRefresh',
                'Refresh stashes'
              )}
              onClick={(event) => {
                event.stopPropagation()
                onRefresh()
              }}
              disabled={loading}
            />
          </div>
        }
      />
      {!isCollapsed &&
        stashes.map((stash) => {
          const isExpanded = expanded.has(stash.sha)
          const files = filesBySha[stash.sha]
          const fileCount = files?.status === 'ready' ? files.entries.length : null
          return (
            <React.Fragment key={stash.sha}>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <StashRow
                    stash={stash}
                    expanded={isExpanded}
                    fileCount={fileCount}
                    onToggleExpand={handleToggleExpand}
                    onOpenStash={onSelectStash}
                  />
                </ContextMenuTrigger>
                <ContextMenuContent className="w-48">
                  <ContextMenuItem onSelect={() => onApplyStash(stash)}>
                    <ArchiveRestore className="size-3.5" />
                    {translate('auto.components.right.sidebar.SourceControl.stashApply', 'Apply')}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onSelect={() => onDeleteStash(stash)}>
                    <Trash2 className="size-3.5" />
                    {translate('auto.components.right.sidebar.SourceControl.stashDelete', 'Delete')}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              {isExpanded && <GitHistoryCommitFiles state={files ?? { status: 'loading' }} />}
            </React.Fragment>
          )
        })}
      {!isCollapsed && state.status === 'error' && stashes.length === 0 && (
        <div className="px-6 py-1 text-[11px] text-destructive">{state.error}</div>
      )}
    </div>
  )
}

function SpinningRefreshIcon({ className }: { className?: string }): React.JSX.Element {
  return <RefreshCw className={cn(className, 'animate-spin')} />
}
