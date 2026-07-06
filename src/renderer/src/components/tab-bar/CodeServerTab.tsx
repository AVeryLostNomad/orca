import { useEffect, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { SquareCode, X, Pin, PinOff } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CLOSE_ALL_CONTEXT_MENUS_EVENT } from './SortableTab'
import type { TabDragItemData } from '../tab-group/useTabDragSplit'
import {
  ACTIVE_TAB_INDICATOR_CLASSES,
  getDropIndicatorClasses,
  getTabRootStateClasses,
  getTabStripBorderClasses,
  type DropIndicator
} from './drop-indicator'
import { preventMiddleButtonDefault } from './middle-button-default-guard'
import { translate } from '@/i18n/i18n'
import { TAB_CONTAINER_WIDTH_CLASSES, TAB_LABEL_WIDTH_CLASSES } from './tab-width-rules'
import { TabWorkspaceLayoutMenuSection } from './TabWorkspaceLayoutMenuSection'
import { useTabStripPointerActivation } from './tab-strip-pointer-activation'

// Why: mirror BrowserTab's chip shell (sortable scaffolding, active indicator,
// width/close-button classes, context menu) so vscode chips reorder, highlight,
// and close identically to sibling chips — only the glyph and passthrough
// label differ (generic code glyph, no favicon/duplicate/open-in-browser).
export default function CodeServerTab({
  label,
  isActive,
  isPinned,
  hasTabsToRight,
  onActivate,
  onClose,
  onCloseToRight,
  onTogglePin,
  dragData,
  dropIndicator,
  includeTopTabBorder = true
}: {
  label: string
  isActive: boolean
  isPinned: boolean
  hasTabsToRight: boolean
  onActivate: () => void
  onClose: () => void
  onCloseToRight: () => void
  onTogglePin: () => void
  dragData: TabDragItemData
  dropIndicator?: DropIndicator
  includeTopTabBorder?: boolean
}): React.JSX.Element {
  // Why: no transform/transition/isDragging styling — the drag design is
  // that tabs stay visually anchored; only the blue insertion bar moves.
  const { attributes, listeners, setNodeRef } = useSortable({
    id: dragData.visibleTabId,
    data: dragData
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPoint, setMenuPoint] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const closeMenu = (): void => setMenuOpen(false)
    window.addEventListener(CLOSE_ALL_CONTEXT_MENUS_EVENT, closeMenu)
    return () => window.removeEventListener(CLOSE_ALL_CONTEXT_MENUS_EVENT, closeMenu)
  }, [])

  // Why: the code-server workbench mounts as an overlay outside the renderer
  // document, so outside-click detection misses it. Dismiss on window blur.
  useEffect(() => {
    if (!menuOpen) {
      return
    }
    const dismiss = (): void => setMenuOpen(false)
    window.addEventListener('blur', dismiss)
    return () => window.removeEventListener('blur', dismiss)
  }, [menuOpen])

  // Why: defer activation to pointer-up so dragging the tab (reorder / move into
  // another pane / split) does not switch the active tab mid-gesture.
  const { onPointerDown: onTabPointerDown } = useTabStripPointerActivation({ onActivate })

  const tabRoot = (
    <div
      ref={setNodeRef}
      data-tab-id={dragData.visibleTabId}
      data-pinned={isPinned ? 'true' : 'false'}
      {...attributes}
      {...listeners}
      className={`group relative flex items-center h-full px-1.5 text-xs cursor-pointer select-none outline-none focus:outline-none focus-visible:outline-none ${getTabStripBorderClasses(hasTabsToRight, { includeTopBorder: includeTopTabBorder })} ${getDropIndicatorClasses(dropIndicator ?? null)} ${getTabRootStateClasses(isActive)}`}
      onPointerDown={(e) => {
        onTabPointerDown(
          e,
          listeners?.onPointerDown as ((event: React.PointerEvent<Element>) => void) | undefined
        )
      }}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault()
        }
      }}
      onMouseUp={preventMiddleButtonDefault}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault()
          e.stopPropagation()
          if (isPinned) {
            return
          }
          onClose()
        }
      }}
    >
      {isActive && <span className={ACTIVE_TAB_INDICATOR_CLASSES} aria-hidden />}
      <SquareCode className="size-3 mr-1 shrink-0 text-blue-500" />
      {isPinned && <Pin className="mr-1 size-3 shrink-0 text-muted-foreground" aria-hidden />}
      <span className={`${TAB_LABEL_WIDTH_CLASSES} mr-1`}>{label}</span>
      {!isPinned && (
        <button
          className={`flex items-center justify-center w-4 h-4 rounded-sm shrink-0 ${
            isActive
              ? 'text-muted-foreground hover:text-foreground hover:bg-muted'
              : 'text-transparent group-hover:text-muted-foreground hover:!text-foreground hover:!bg-muted'
          }`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  )

  return (
    <>
      <div
        className={TAB_CONTAINER_WIDTH_CLASSES}
        onContextMenuCapture={(event) => {
          event.preventDefault()
          window.dispatchEvent(new Event(CLOSE_ALL_CONTEXT_MENUS_EVENT))
          setMenuPoint({ x: event.clientX, y: event.clientY })
          setMenuOpen(true)
        }}
      >
        {menuOpen ? (
          tabRoot
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>{tabRoot}</TooltipTrigger>
            <TooltipContent
              side="bottom"
              sideOffset={6}
              className="max-w-80 whitespace-normal break-words text-left"
            >
              {label}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            aria-hidden
            tabIndex={-1}
            className="pointer-events-none fixed size-px opacity-0"
            style={{ left: menuPoint.x, top: menuPoint.y }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="min-w-[11rem] rounded-[11px] border-border/80 p-1 shadow-[0_16px_36px_rgba(0,0,0,0.24)]"
          sideOffset={0}
          align="start"
        >
          <DropdownMenuItem onSelect={onTogglePin}>
            {isPinned ? (
              <PinOff className="mr-1.5 size-3.5" />
            ) : (
              <Pin className="mr-1.5 size-3.5" />
            )}
            {isPinned
              ? translate('auto.components.tab.bar.CodeServerTab.c5aaee8c39', 'Unpin Tab')
              : translate('auto.components.tab.bar.CodeServerTab.911542656f', 'Pin Tab')}
          </DropdownMenuItem>
          <TabWorkspaceLayoutMenuSection
            unifiedTabId={dragData.unifiedTabId}
            groupId={dragData.groupId}
          />
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => !isPinned && onClose()} disabled={isPinned}>
            {translate('auto.components.tab.bar.CodeServerTab.1611a1324b', 'Close')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onCloseToRight} disabled={!hasTabsToRight}>
            {translate(
              'auto.components.tab.bar.CodeServerTab.9dd880bd56',
              'Close Tabs To The Right'
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
