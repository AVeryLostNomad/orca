import React, { useRef, useState } from 'react'
import { AlertTriangle, Loader2, ServerOff } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../../../shared/execution-host'
import type { SidebarHostPage } from './sidebar-host-pages'
import { SidebarHostMenu } from './SidebarHostMenu'

export function getSidebarHostPagePanelId(hostId: ExecutionHostId): string {
  return `sidebar-host-page-${encodeURIComponent(hostId)}`
}

function getHostPageTitle(page: SidebarHostPage, sectionKind: 'projects' | 'workspaces'): string {
  if (page.id !== LOCAL_EXECUTION_HOST_ID) {
    return page.label
  }
  return sectionKind === 'projects'
    ? translate('dashboard.sidebar.localProjects', 'Local Projects')
    : translate('dashboard.sidebar.localWorkspaces', 'Local Workspaces')
}

function getHostPageStatus(
  page: SidebarHostPage
): { icon: React.JSX.Element; text: string } | null {
  if (page.health === 'connecting') {
    return {
      icon: <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />,
      text: translate('dashboard.sidebar.hostConnecting', 'Connecting…')
    }
  }
  if (page.health === 'blocked') {
    return {
      icon: <AlertTriangle className="size-3 shrink-0 text-destructive" />,
      text: translate('auto.components.sidebar.WorktreeList.7a8b9c0d1e', 'Update required')
    }
  }
  if (page.connectionStatus === 'auth-failed') {
    return {
      icon: <AlertTriangle className="size-3 shrink-0 text-destructive" />,
      text: translate(
        'auto.components.sidebar.WorktreeList.hostAuthNeeded',
        'Authentication needed'
      )
    }
  }
  if (page.health === 'error') {
    return {
      icon: <AlertTriangle className="size-3 shrink-0 text-destructive" />,
      text: translate('dashboard.sidebar.hostUnreachable', 'Unreachable')
    }
  }
  if (page.health === 'disconnected') {
    return {
      icon: <ServerOff className="size-3 shrink-0 text-muted-foreground/80" />,
      text: translate('auto.components.sidebar.WorktreeList.hostDisconnected', 'Disconnected')
    }
  }
  return null
}

function SidebarHostPagePips({
  pages,
  activePageId,
  sectionKind,
  onSelectPage
}: {
  pages: readonly SidebarHostPage[]
  activePageId: ExecutionHostId
  sectionKind: 'projects' | 'workspaces'
  onSelectPage: (hostId: ExecutionHostId) => void
}): React.JSX.Element {
  const tabRefs = useRef(new Map<ExecutionHostId, HTMLButtonElement>())
  const activeIndex = pages.findIndex((page) => page.id === activePageId)
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    const next = pages[activeIndex + step]
    if (!step || !next) {
      return
    }
    event.preventDefault()
    onSelectPage(next.id)
    tabRefs.current.get(next.id)?.focus()
  }
  return (
    <div
      role="tablist"
      aria-label={translate('dashboard.sidebar.hostPages', 'Hosts')}
      className="flex shrink-0 items-center"
      onKeyDown={handleKeyDown}
    >
      {pages.map((page) => {
        const active = page.id === activePageId
        const title = getHostPageTitle(page, sectionKind)
        const attention = page.health === 'blocked' || page.health === 'error'
        return (
          <Tooltip key={page.id}>
            <TooltipTrigger asChild>
              <button
                ref={(element) => {
                  if (element) {
                    tabRefs.current.set(page.id, element)
                  } else {
                    tabRefs.current.delete(page.id)
                  }
                }}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={getSidebarHostPagePanelId(page.id)}
                aria-label={title}
                tabIndex={active ? 0 : -1}
                className="group/pip flex h-5 items-center rounded-sm px-[3px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                onClick={() => onSelectPage(page.id)}
              >
                <span
                  className={cn(
                    'block h-1.5 rounded-full transition-[width,background-color] duration-300 ease-out motion-reduce:transition-none',
                    active
                      ? 'w-3.5 bg-foreground/70'
                      : attention
                        ? 'w-1.5 bg-destructive/60 group-hover/pip:bg-destructive/80'
                        : 'w-1.5 bg-muted-foreground/35 group-hover/pip:bg-muted-foreground/70'
                  )}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {title}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

/**
 * Sidebar section title for the paged host sidebars: "Local Projects" or the remote host's
 * name, the page pips, and host status/actions for remote pages.
 */
export function SidebarHostPageTitle({
  pages,
  activePage,
  sectionKind,
  onSelectPage
}: {
  pages: readonly SidebarHostPage[]
  activePage: SidebarHostPage
  sectionKind: 'projects' | 'workspaces'
  onSelectPage: (hostId: ExecutionHostId) => void
}): React.JSX.Element {
  const remote = activePage.id !== LOCAL_EXECUTION_HOST_ID
  const title =
    pages.length > 1 || remote
      ? getHostPageTitle(activePage, sectionKind)
      : sectionKind === 'projects'
        ? translate('dashboard.sidebar.projects', 'Projects')
        : translate('dashboard.sidebar.workspaces', 'Workspaces')
  const status = remote ? getHostPageStatus(activePage) : null
  const activeIndex = pages.findIndex((page) => page.id === activePage.id)
  // Why: slide the title in from the side the new page came from, matching the pager.
  const [titleMotion, setTitleMotion] = useState<{
    pageId: ExecutionHostId
    index: number
    enterClass: string | null
  }>({ pageId: activePage.id, index: activeIndex, enterClass: null })
  if (titleMotion.pageId !== activePage.id) {
    setTitleMotion({
      pageId: activePage.id,
      index: activeIndex,
      enterClass: activeIndex < titleMotion.index ? 'slide-in-from-left-2' : 'slide-in-from-right-2'
    })
  }
  const titleEnterClass = titleMotion.pageId === activePage.id ? titleMotion.enterClass : null
  return (
    <div className="group/host-page flex min-w-0 items-center gap-0.5 pl-2">
      {status ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex shrink-0 pr-1" aria-label={status.text}>
              {status.icon}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {status.text}
          </TooltipContent>
        </Tooltip>
      ) : null}
      <span
        key={activePage.id}
        className={cn(
          'min-w-0 select-none truncate pr-0.5 text-xs font-semibold text-muted-foreground/80',
          titleEnterClass &&
            `animate-in fade-in-0 duration-300 motion-reduce:animate-none ${titleEnterClass}`
        )}
        data-sidebar-section-title={sectionKind}
      >
        {title}
      </span>
      {pages.length > 1 ? (
        <SidebarHostPagePips
          pages={pages}
          activePageId={activePage.id}
          sectionKind={sectionKind}
          onSelectPage={onSelectPage}
        />
      ) : null}
      {remote ? <SidebarHostMenu host={activePage} /> : null}
    </div>
  )
}
