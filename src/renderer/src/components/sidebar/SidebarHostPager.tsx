import React, { Activity, useCallback, useRef } from 'react'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { SidebarHostPage } from './sidebar-host-pages'
import { getSidebarHostPagePanelId } from './SidebarHostPageTitle'
import { useSidebarHostPagerGesture } from './use-sidebar-host-pager-gesture'

type SidebarHostPagerProps = {
  pages: readonly SidebarHostPage[]
  activePageId: ExecutionHostId
  onActivePageChange: (hostId: ExecutionHostId) => void
  renderPage: (page: SidebarHostPage, active: boolean) => React.ReactNode
}

/** One full sidebar per execution host, laid side by side; swipe or pips slide between them. */
export function SidebarHostPager({
  pages,
  activePageId,
  onActivePageChange,
  renderPage
}: SidebarHostPagerProps): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const activeIndex = Math.max(
    0,
    pages.findIndex((page) => page.id === activePageId)
  )
  const handleNavigate = useCallback(
    (index: number) => {
      const page = pages[index]
      if (page) {
        onActivePageChange(page.id)
      }
    },
    [onActivePageChange, pages]
  )
  const { engaged, settleFromIndex } = useSidebarHostPagerGesture({
    viewportRef,
    trackRef,
    pageCount: pages.length,
    activeIndex,
    onNavigate: handleNavigate
  })
  // Why: idle pages stay hidden so they neither render store churn nor hold subscriptions; a
  // swipe or slide wakes the pages it can reveal.
  const firstAwakeIndex = Math.min(activeIndex, settleFromIndex ?? activeIndex) - 1
  const lastAwakeIndex = Math.max(activeIndex, settleFromIndex ?? activeIndex) + 1
  return (
    <div
      ref={viewportRef}
      className="relative flex min-h-0 flex-1 overflow-hidden"
      data-sidebar-host-pager=""
    >
      <div ref={trackRef} className="flex min-h-0 w-full flex-1 will-change-transform">
        {pages.map((page, index) => {
          const active = index === activeIndex
          const awake = active || (engaged && index >= firstAwakeIndex && index <= lastAwakeIndex)
          return (
            <div
              key={page.id}
              id={getSidebarHostPagePanelId(page.id)}
              role={pages.length > 1 ? 'tabpanel' : undefined}
              aria-label={pages.length > 1 ? page.label : undefined}
              className="flex min-h-0 w-full shrink-0 flex-col"
              inert={!active}
              data-sidebar-host-page={page.id}
            >
              <Activity mode={awake ? 'visible' : 'hidden'}>{renderPage(page, active)}</Activity>
            </div>
          )
        })}
      </div>
    </div>
  )
}
