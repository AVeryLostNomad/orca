import { useEffect, useMemo } from 'react'
import { useAppStore } from '@/store'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { SidebarHostPage } from './sidebar-host-pages'
import { getSidebarRevealTargetHostIds, resolveSidebarRevealPageId } from './sidebar-reveal-host'

/**
 * Slides the pager to the page that owns a pending sidebar reveal and returns that page, so
 * only it consumes the reveal — a page that cannot show the target would otherwise drop it.
 */
export function useSidebarHostPageReveal(
  pages: readonly SidebarHostPage[],
  activePageId: ExecutionHostId
): ExecutionHostId {
  const pendingRevealWorktree = useAppStore((s) => s.pendingRevealWorktree)
  const pendingRevealSidebarRow = useAppStore((s) => s.pendingRevealSidebarRow)
  const setSidebarHostPageId = useAppStore((s) => s.setSidebarHostPageId)
  const revealPageId = useMemo(() => {
    const reveal = pendingRevealWorktree ?? pendingRevealSidebarRow
    if (!reveal) {
      return activePageId
    }
    return resolveSidebarRevealPageId(
      pages,
      activePageId,
      getSidebarRevealTargetHostIds(useAppStore.getState(), reveal)
    )
  }, [activePageId, pages, pendingRevealSidebarRow, pendingRevealWorktree])
  useEffect(() => {
    if (revealPageId !== activePageId) {
      setSidebarHostPageId(revealPageId)
    }
  }, [activePageId, revealPageId, setSidebarHostPageId])
  return revealPageId
}
