import React from 'react'
import { Ellipsis, ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { REPO_HEADER_ACTION_BUTTON_CLASS } from '../../repo-header-action-button-class'
import {
  handleRepoHeaderActionPointerDown,
  stopRepoHeaderKeyboardToggle,
  stopRepoHeaderMenuEvent
} from './header-event-guards'

export function ProjectGroupHeaderMenu({
  groupId,
  label,
  onChangeIcon,
  onRename,
  onDelete
}: {
  groupId: string
  label: string
  onRename: (groupId: string, currentName: string) => void
  onChangeIcon: (groupId: string) => void
  onDelete: (groupId: string, groupName: string) => void
}): React.JSX.Element {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={REPO_HEADER_ACTION_BUTTON_CLASS}
          data-repo-header-action=""
          aria-label={translate(
            'auto.components.sidebar.WorktreeList.79465e9034',
            'Group actions for {{value0}}',
            { value0: label }
          )}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={stopRepoHeaderKeyboardToggle}
          onPointerDown={handleRepoHeaderActionPointerDown}
        >
          <Ellipsis className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={6}
        // Why: Radix portals keep React bubbling through the project header; block menu events from arming row drag/collapse.
        onPointerDown={stopRepoHeaderMenuEvent}
        onMouseDown={stopRepoHeaderMenuEvent}
        onPointerUp={stopRepoHeaderMenuEvent}
        onMouseUp={stopRepoHeaderMenuEvent}
        onClick={stopRepoHeaderMenuEvent}
        onKeyDown={stopRepoHeaderMenuEvent}
      >
        <DropdownMenuItem onSelect={() => onChangeIcon(groupId)}>
          <ImageIcon className="size-3.5" />
          {translate('auto.components.sidebar.WorktreeList.changeGroupIcon', 'Change icon')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onRename(groupId, label)}>
          {translate('auto.components.sidebar.WorktreeList.4d7b73658c', 'Rename group')}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => onDelete(groupId, label)}>
          {translate('auto.components.sidebar.WorktreeList.902115cdbe', 'Delete group')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
