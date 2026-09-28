import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSidebarResize } from '@/hooks/useSidebarResize'
import SidebarHeader from './SidebarHeader'
import SidebarNav from './SidebarNav'
import SetupScriptPromptCard from './SetupScriptPromptCard'
import WorktreeList from './WorktreeList'
import SidebarToolbar from './SidebarToolbar'
import WorkspaceKanbanDrawer from './WorkspaceKanbanDrawer'
import type { VirtualizedScrollAnchor } from '@/hooks/useVirtualizedScrollAnchor'
import { cn } from '@/lib/utils'
import { FolderPlus, Loader2 } from 'lucide-react'
import { ActivityThreadCollapseContext } from '@/components/activity/activity-thread-collapse-context'
import { useSidebarProjectDrop } from './useSidebarProjectDrop'
import { useWorkspaceBoardPanel } from './useWorkspaceBoardPanel'
import { useWorkspaceRevealBodyRedirect } from './use-workspace-reveal-body-redirect'
import { resolveLeftSidebarStyleVariables } from '@/lib/left-sidebar-appearance'
import { useSystemPrefersDark } from '@/components/terminal-pane/use-system-prefers-dark'
import { lazyWithRetry } from '@/lib/lazy-with-retry'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../../../shared/execution-host'
import { SidebarHostPager } from './SidebarHostPager'
import type { SidebarHostPage } from './sidebar-host-pages'
import { useSidebarHostPages } from './use-sidebar-host-pages'
import { useSidebarHostPageReveal } from './use-sidebar-host-page-reveal'

// Why lazy: the Agents list pulls the whole activity pipeline (virtualizer, markdown
// previews, thread derivation); users on the workspace view should not load or render any of it.
const SidebarAgentsList = lazyWithRetry(() => import('./SidebarAgentsList'))

const WorktreeMetaDialog = lazyWithRetry(() => import('./WorktreeMetaDialog'))
const RemoveFolderDialog = lazyWithRetry(() => import('./RemoveFolderDialog'))
const WorktreeVisibilityDialog = lazyWithRetry(() => import('./WorktreeVisibilityDialog'))
const OrcaYamlTrustDialog = lazyWithRetry(() => import('./OrcaYamlTrustDialog'))
const ForgetSshWorkspaceDialog = lazyWithRetry(() => import('./ForgetSshWorkspaceDialog'))
const AgentDashboardSidebarHost = lazyWithRetry(() => import('./AgentDashboardSidebarHost'))

const MIN_WIDTH = 220
const MAX_WIDTH = 500
// Why: straddle the sidebar/terminal seam so the divider sits on the border-l
// instead of leaving a blank strip between the hover target and the edge.
export const WORKTREE_SIDEBAR_RESIZE_HANDLE_CLASS_NAME =
  'group absolute -right-1.5 top-0 z-10 flex h-full w-3 cursor-col-resize items-stretch justify-center'
export const WORKTREE_SIDEBAR_RESIZE_HANDLE_LINE_CLASS_NAME =
  'h-full w-px bg-transparent transition-colors group-hover:bg-ring/50 group-active:bg-ring'

type SidebarProps = {
  worktreeScrollOffsetRef: React.MutableRefObject<number>
  worktreeScrollAnchorRef: React.MutableRefObject<VirtualizedScrollAnchor>
}

type HostPageScrollRefs = {
  scrollOffsetRef: React.MutableRefObject<number>
  scrollAnchorRef: React.MutableRefObject<VirtualizedScrollAnchor>
}

function Sidebar({
  worktreeScrollOffsetRef,
  worktreeScrollAnchorRef
}: SidebarProps): React.JSX.Element {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const sidebarWidth = useAppStore((s) => s.sidebarWidth)
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth)
  const repos = useAppStore((s) => s.repos)
  const startupWorktreeRefreshCompleted = useAppStore((s) => s.startupWorktreeRefreshCompleted)
  const settings = useAppStore((s) => s.settings)
  const sidebarBody = useAppStore((s) => s.sidebarBody ?? 'workspaces')
  const showAgentDashboard = settings?.experimentalAgentDashboardPopout === true
  const agentDashboardDrawerOpen = useAppStore((s) => s.agentDashboardDrawerOpen)
  const setAgentDashboardDrawerOpen = useAppStore((s) => s.setAgentDashboardDrawerOpen)
  const agentReadFilter = useAppStore((s) => s.agentsReadFilter)
  const setAgentReadFilter = useAppStore((s) => s.setAgentsReadFilter)
  const agentGroupBy = useAppStore((s) => s.agentsGroupBy)
  const setAgentGroupBy = useAppStore((s) => s.setAgentsGroupBy)
  const [agentQuery, setAgentQuery] = React.useState('')
  const [agentOptionsTarget, setAgentOptionsTarget] = React.useState<HTMLDivElement | null>(null)
  const agentsScrollTopRef = React.useRef(0)
  // Held here so collapsed groups (and the layout the saved scrollTop assumes)
  // survive the Agents list unmounting on sidebar body switches.
  const [agentsCollapsedGroupKeys, setAgentsCollapsedGroupKeys] = React.useState<
    ReadonlySet<string>
  >(() => new Set())
  const agentsCollapseState = useMemo(
    () => ({
      collapsedGroupKeys: agentsCollapsedGroupKeys,
      onToggleGroupCollapse: (groupKey: string) =>
        setAgentsCollapsedGroupKeys((prev) => {
          const next = new Set(prev)
          if (next.has(groupKey)) {
            next.delete(groupKey)
          } else {
            next.add(groupKey)
          }
          return next
        })
    }),
    [agentsCollapsedGroupKeys]
  )
  const fetchAllWorktrees = useAppStore((s) => s.fetchAllWorktrees)
  const activeModal = useAppStore((s) => s.activeModal)
  const statusBarVisible = useAppStore((s) => s.statusBarVisible)
  const systemPrefersDark = useSystemPrefersDark()
  const appThemeTerminalTheme = useAppStore((s) => s.appThemeTerminalTheme)
  const leftSidebarStyle = useMemo(
    () => resolveLeftSidebarStyleVariables(settings, systemPrefersDark, appThemeTerminalTheme),
    [settings, systemPrefersDark, appThemeTerminalTheme]
  ) as React.CSSProperties | undefined
  const { nativeDropTarget, dropHandlers, affordance } = useSidebarProjectDrop()
  const {
    workspaceBoardOpen,
    workspaceBoardRenderedOpen,
    workspaceBoardDragPreviewOpen,
    workspaceBoardMenuOpen,
    toggleWorkspaceBoard,
    handleWorkspaceBoardOpenChange,
    setWorkspaceBoardMenuOpen,
    closeWorkspaceBoard,
    previewWorkspaceBoardFromDrag,
    solidifyWorkspaceBoardFromDrag,
    cancelWorkspaceBoardDragPreview
  } = useWorkspaceBoardPanel()

  const setLiveSidebarWidth = React.useCallback((width: number) => {
    document.documentElement.style.setProperty('--workspace-sidebar-live-width', `${width}px`)
  }, [])

  const repoCount = repos.length
  const previousRepoCountRef = React.useRef(repoCount)
  useEffect(() => {
    const repoCountChanged = previousRepoCountRef.current !== repoCount
    previousRepoCountRef.current = repoCount
    // Why: App owns the initial all-host scan; partial startup catalogs must not trigger broad scans or stale-state purges.
    if (startupWorktreeRefreshCompleted && repoCountChanged && repoCount > 0) {
      void fetchAllWorktrees()
    }
  }, [repoCount, startupWorktreeRefreshCompleted, fetchAllWorktrees])

  useEffect(() => {
    if (!sidebarOpen && workspaceBoardRenderedOpen) {
      closeWorkspaceBoard()
    }
  }, [closeWorkspaceBoard, sidebarOpen, workspaceBoardRenderedOpen])

  useEffect(() => {
    if (!showAgentDashboard && agentDashboardDrawerOpen) {
      setAgentDashboardDrawerOpen(false)
    }
  }, [agentDashboardDrawerOpen, setAgentDashboardDrawerOpen, showAgentDashboard])

  const { containerRef, onResizeStart, isResizing } = useSidebarResize<HTMLDivElement>({
    isOpen: sidebarOpen,
    width: sidebarWidth,
    minWidth: MIN_WIDTH,
    maxWidth: MAX_WIDTH,
    deltaSign: 1,
    setWidth: setSidebarWidth,
    onDraftWidthChange: setLiveSidebarWidth
  })

  useWorkspaceRevealBodyRedirect(sidebarOpen && sidebarBody === 'agents')

  const { pages: hostPages, activePage: activeHostPage } = useSidebarHostPages()
  const setSidebarHostPageId = useAppStore((s) => s.setSidebarHostPageId)
  const revealHostPageId = useSidebarHostPageReveal(hostPages, activeHostPage.id)
  // Why: each host page keeps its own scroll position; local reuses the app-owned refs.
  const [remotePageScrollRefs] = useState(() => new Map<ExecutionHostId, HostPageScrollRefs>())
  const renderHostPage = useCallback(
    (page: SidebarHostPage, active: boolean) => {
      let scrollRefs: HostPageScrollRefs = {
        scrollOffsetRef: worktreeScrollOffsetRef,
        scrollAnchorRef: worktreeScrollAnchorRef
      }
      if (page.id !== LOCAL_EXECUTION_HOST_ID) {
        const cached = remotePageScrollRefs.get(page.id)
        scrollRefs = cached ?? {
          scrollOffsetRef: { current: 0 },
          scrollAnchorRef: { current: null }
        }
        remotePageScrollRefs.set(page.id, scrollRefs)
      }
      return (
        <WorktreeList
          hostPageId={page.id}
          isActivePage={active}
          consumesReveals={active && page.id === revealHostPageId}
          scrollOffsetRef={scrollRefs.scrollOffsetRef}
          scrollAnchorRef={scrollRefs.scrollAnchorRef}
          workspaceBoardOpen={workspaceBoardOpen}
          onWorkspaceBoardDragPreviewStart={previewWorkspaceBoardFromDrag}
          onWorkspaceBoardDragPreviewCommit={solidifyWorkspaceBoardFromDrag}
          onWorkspaceBoardDragPreviewCancel={cancelWorkspaceBoardDragPreview}
        />
      )
    },
    [
      cancelWorkspaceBoardDragPreview,
      previewWorkspaceBoardFromDrag,
      remotePageScrollRefs,
      revealHostPageId,
      solidifyWorkspaceBoardFromDrag,
      workspaceBoardOpen,
      worktreeScrollAnchorRef,
      worktreeScrollOffsetRef
    ]
  )

  return (
    <TooltipProvider delayDuration={400}>
      <div
        ref={containerRef}
        data-native-file-drop-target={sidebarOpen ? nativeDropTarget : undefined}
        className="relative min-h-0 flex-shrink-0 bg-worktree-sidebar flex flex-col overflow-hidden scrollbar-sleek-parent"
        style={leftSidebarStyle}
        {...dropHandlers}
      >
        {sidebarOpen && (
          <>
            {/* Fixed controls */}
            <SidebarNav />
            <SidebarHeader
              onWorkspaceBoardMenuOpenChange={setWorkspaceBoardMenuOpen}
              activityOptionsTarget={setAgentOptionsTarget}
              hostPages={hostPages}
              activeHostPage={activeHostPage}
              onHostPageChange={setSidebarHostPageId}
            />
            {sidebarBody === 'agents' ? (
              <React.Suspense fallback={<div className="min-h-0 flex-1" />}>
                <ActivityThreadCollapseContext.Provider value={agentsCollapseState}>
                  <SidebarAgentsList
                    readFilter={agentReadFilter}
                    setReadFilter={setAgentReadFilter}
                    groupBy={agentGroupBy}
                    setGroupBy={setAgentGroupBy}
                    query={agentQuery}
                    setQuery={setAgentQuery}
                    optionsTarget={agentOptionsTarget}
                    scrollTopRef={agentsScrollTopRef}
                  />
                </ActivityThreadCollapseContext.Provider>
              </React.Suspense>
            ) : (
              <SidebarHostPager
                pages={hostPages}
                activePageId={activeHostPage.id}
                onActivePageChange={setSidebarHostPageId}
                renderPage={renderHostPage}
              />
            )}

            <div className="relative shrink-0">
              <SetupScriptPromptCard />

              {/* Fixed bottom toolbar */}
              <SidebarToolbar
                workspaceBoardOpen={workspaceBoardOpen}
                workspaceBoardDragPreviewOpen={workspaceBoardDragPreviewOpen}
                onWorkspaceBoardToggle={toggleWorkspaceBoard}
              />
            </div>
          </>
        )}

        {sidebarOpen && affordance.visible ? (
          <div
            className={cn(
              'pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-1.5 rounded-md border bg-worktree-sidebar-accent/95 px-4 text-center text-worktree-sidebar-accent-foreground shadow-xs',
              affordance.tone === 'blocked'
                ? 'border-destructive/70'
                : 'border-worktree-sidebar-ring/70'
            )}
          >
            {affordance.tone === 'busy' ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            ) : (
              <FolderPlus className="size-5 text-muted-foreground" />
            )}
            <div className="text-sm font-medium">{affordance.label}</div>
            <div className="text-xs text-muted-foreground">{affordance.description}</div>
          </div>
        ) : null}

        {/* Resize handle */}
        {sidebarOpen && (
          <div
            data-sidebar-resize-handle=""
            className={cn(WORKTREE_SIDEBAR_RESIZE_HANDLE_CLASS_NAME, isResizing && 'bg-ring/10')}
            onMouseDown={onResizeStart}
          >
            <div
              className={cn(
                WORKTREE_SIDEBAR_RESIZE_HANDLE_LINE_CLASS_NAME,
                isResizing && 'bg-ring'
              )}
            />
          </div>
        )}
      </div>

      {/* Dialogs render outside sidebar to avoid clipping. Lazy-load them only
      for the modal that needs their flow-specific hooks and UI. */}
      <React.Suspense fallback={null}>
        {activeModal === 'edit-meta' ? <WorktreeMetaDialog /> : null}
        {activeModal === 'confirm-remove-folder' ? <RemoveFolderDialog /> : null}
        {activeModal === 'worktree-visibility' ? <WorktreeVisibilityDialog /> : null}
        {activeModal === 'confirm-orca-yaml-hooks' ? <OrcaYamlTrustDialog /> : null}
        {activeModal === 'forget-ssh-workspace' ? <ForgetSshWorkspaceDialog /> : null}
      </React.Suspense>
      {sidebarOpen ? (
        <WorkspaceKanbanDrawer
          leftSidebarStyle={leftSidebarStyle}
          open={workspaceBoardRenderedOpen}
          statusBarVisible={statusBarVisible}
          dragPreview={workspaceBoardDragPreviewOpen}
          preserveOpenForMenu={workspaceBoardMenuOpen}
          onOpenChange={handleWorkspaceBoardOpenChange}
          onMenuOpenChange={setWorkspaceBoardMenuOpen}
          hostPageId={activeHostPage.id}
        />
      ) : null}
      {showAgentDashboard ? (
        <React.Suspense fallback={null}>
          <AgentDashboardSidebarHost
            sidebarOpen={sidebarOpen}
            workspaceBoardOpen={workspaceBoardOpen}
            closeWorkspaceBoard={closeWorkspaceBoard}
            leftSidebarStyle={leftSidebarStyle}
            statusBarVisible={statusBarVisible}
          />
        </React.Suspense>
      ) : null}
    </TooltipProvider>
  )
}

export default React.memo(Sidebar)
