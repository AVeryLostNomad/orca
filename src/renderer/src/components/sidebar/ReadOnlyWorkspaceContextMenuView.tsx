import type React from 'react'
import { Copy } from 'lucide-react'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { WorktreeContextMenuModel } from './use-worktree-context-menu-model'
import { WorktreeContextMenuFrame } from './WorktreeContextMenuFrame'
import { WorktreeRowOpenInSubMenu } from './WorktreeRowOpenInSubMenu'
import { WorkspaceSleepMenuItems } from './WorkspaceSleepMenuItems'

/** Derived workspaces (Group Wide) have no record to edit: only path actions and Sleep. */
export function ReadOnlyWorkspaceContextMenuView({
  model
}: {
  model: WorktreeContextMenuModel
}): React.JSX.Element {
  const { worktree, repo, isDeleting, deletingContext, sleepableWorktrees } = model
  return (
    <WorktreeContextMenuFrame
      model={model}
      items={
        <>
          <WorktreeRowOpenInSubMenu
            worktree={worktree}
            connectionId={repo?.connectionId ?? null}
            disabled={isDeleting}
          />
          <DropdownMenuItem onSelect={model.handleCopyPath} disabled={isDeleting}>
            <Copy className="size-3.5" />
            {translate('auto.components.sidebar.WorktreeContextMenu.3350101edb', 'Copy Path')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <WorkspaceSleepMenuItems
            isMultiContext={false}
            sleepLabel={model.sleepLabel}
            sleepDisabled={deletingContext || sleepableWorktrees.length === 0}
            descendantCount={0}
            subtreeSleepDisabled
            onSleep={model.handleCloseTerminals}
            onSleepSubtree={model.handleSleepSubtree}
          />
        </>
      }
    />
  )
}
