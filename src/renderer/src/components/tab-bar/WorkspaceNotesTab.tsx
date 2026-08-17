import React from 'react'
import { NotebookPen } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import {
  ACTIVE_TAB_INDICATOR_CLASSES,
  getTabRootStateClasses,
  getTabStripBorderClasses
} from './drop-indicator'

/** Icon-only chip for the permanent floating-workspace notes tab: no close button,
 *  no context menu, not draggable — it can never be closed or unpinned. */
export function WorkspaceNotesTab({
  tabId,
  isActive,
  onActivate,
  includeTopTabBorder
}: {
  tabId: string
  isActive: boolean
  onActivate: () => void
  includeTopTabBorder: boolean
}): React.JSX.Element {
  const label = translate('auto.components.tab.bar.WorkspaceNotesTab.a91f4c07d2', 'Notes')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          data-tab-id={tabId}
          data-pinned="true"
          data-workspace-notes-tab="true"
          role="tab"
          aria-label={label}
          aria-selected={isActive}
          className={`group relative flex shrink-0 items-center h-full px-2.5 text-xs cursor-pointer select-none outline-none focus:outline-none focus-visible:outline-none ${getTabStripBorderClasses(true, { includeTopBorder: includeTopTabBorder })} ${getTabRootStateClasses(isActive)}`}
          onPointerDown={(e) => {
            if (e.button === 0) {
              onActivate()
            }
          }}
          // Middle-click closes ordinary tabs; the notes tab is permanent.
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault()
            }
          }}
          onAuxClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          {isActive && <span className={ACTIVE_TAB_INDICATOR_CLASSES} aria-hidden />}
          <NotebookPen
            className={`size-3.5 shrink-0 ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
