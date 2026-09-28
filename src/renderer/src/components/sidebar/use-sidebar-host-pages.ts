import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { getSettingsFocusedExecutionHostId } from '../../../../shared/execution-host'
import { EMPTY_PROJECT_GROUPS } from './worktree-list/viewport/viewport-props'
import { getVisibleSidebarHostIdSet } from './worktree-list/listing/host-filtering'
import { useSidebarHostScopeOptions } from './use-sidebar-host-scope-options'
import {
  buildSidebarHostPages,
  collectSidebarContentHostIds,
  resolveActiveSidebarHostPage,
  type SidebarHostPage
} from './sidebar-host-pages'

export function useSidebarHostPages(): {
  pages: SidebarHostPage[]
  activePage: SidebarHostPage
} {
  const { hostOptions } = useSidebarHostScopeOptions()
  const workspaceHostOrder = useAppStore((s) => s.workspaceHostOrder)
  const repos = useAppStore((s) => s.repos)
  const projectGroups = useAppStore((s) => s.projectGroups ?? EMPTY_PROJECT_GROUPS)
  const folderWorkspaces = useAppStore((s) => s.folderWorkspaces)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const defaultHostId = useAppStore((s) => getSettingsFocusedExecutionHostId(s.settings))
  const visibleWorkspaceHostIds = useAppStore((s) => s.visibleWorkspaceHostIds)
  const workspaceHostScope = useAppStore((s) => s.workspaceHostScope)
  const requestedHostId = useAppStore((s) => s.sidebarHostPageId)

  // Why a joined key: worktree churn rebuilds the set, but pages only move when a host gains/loses rows.
  const contentHostKey = useMemo(
    () =>
      [
        ...collectSidebarContentHostIds({
          repos,
          projectGroups,
          folderWorkspaces,
          worktreesByRepo,
          defaultHostId
        })
      ]
        .sort()
        .join('\n'),
    [defaultHostId, folderWorkspaces, projectGroups, repos, worktreesByRepo]
  )
  const pages = useMemo(
    () =>
      buildSidebarHostPages({
        hostOptions,
        workspaceHostOrder,
        contentHostIds: new Set(
          contentHostKey ? (contentHostKey.split('\n') as SidebarHostPage['id'][]) : []
        ),
        visibleHostIdSet: getVisibleSidebarHostIdSet(visibleWorkspaceHostIds, workspaceHostScope)
      }),
    [contentHostKey, hostOptions, visibleWorkspaceHostIds, workspaceHostOrder, workspaceHostScope]
  )
  const activePage = useMemo(
    () => resolveActiveSidebarHostPage(pages, requestedHostId),
    [pages, requestedHostId]
  )
  return { pages, activePage }
}
