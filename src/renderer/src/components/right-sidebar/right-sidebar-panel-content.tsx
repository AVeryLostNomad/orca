import { Suspense } from 'react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import type { ActiveRightSidebarTab } from '@/store/slices/editor'
import { isPluginPanelTabKey } from '../../../../shared/plugins/plugin-manifest'
import { useAppStore } from '@/store'
import { RecoverableRenderErrorBoundary } from '@/components/error-boundaries/RecoverableRenderErrorBoundary'
import { useUnityPanelSection } from '../unity/unity-panel-section'

const FileExplorer = lazy(() => import('./FileExplorer'))
const SourceControl = lazy(() => import('./SourceControl'))
const ChecksPanel = lazy(() => import('./ChecksPanel'))
const PortsPanel = lazy(() => import('./PortsPanel'))
const AiVaultSidebarPanel = lazy(() => import('./AiVaultSidebarPanel'))
const FolderWorkspaceWorktreesPanel = lazy(() => import('./FolderWorkspaceWorktreesPanel'))
const FolderWorkspacePrChecksPanel = lazy(() => import('./FolderWorkspacePrChecksPanel'))
const PluginPanel = lazy(() => import('./PluginPanel'))
const UnityPanel = lazy(() => import('../unity/UnityPanel'))

type RightSidebarPanelContentProps = {
  effectiveTab: ActiveRightSidebarTab
  rightSidebarOpen: boolean
}

export function RightSidebarPanelContent({
  effectiveTab,
  rightSidebarOpen
}: RightSidebarPanelContentProps): React.JSX.Element {
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const explorerView = useAppStore((s) =>
    effectiveTab === 'explorer' ? s.rightSidebarExplorerView : null
  )
  const unitySection = useUnityPanelSection()
  const resetKey = JSON.stringify([effectiveTab, explorerView, activeWorktreeId])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <RecoverableRenderErrorBoundary
        boundaryId={`right-sidebar.${effectiveTab}`}
        surface="right-sidebar"
        resetKey={resetKey}
      >
        <Suspense fallback={null}>
          {effectiveTab === 'explorer' && <FileExplorer />}
          {effectiveTab === 'source-control' && <SourceControl />}
          {effectiveTab === 'checks' && <ChecksPanel />}
          {/* SSH forwarding needs raw ports.detect data absent from the workspace-scoped status popover. */}
          {effectiveTab === 'ports' && (
            <PortsPanel isVisible={rightSidebarOpen && effectiveTab === 'ports'} />
          )}
          {effectiveTab === 'vault' && <AiVaultSidebarPanel />}
          {effectiveTab === 'workspaces' && <FolderWorkspaceWorktreesPanel />}
          {effectiveTab === 'pr-checks' && (
            <FolderWorkspacePrChecksPanel
              isVisible={rightSidebarOpen && effectiveTab === 'pr-checks'}
            />
          )}
          {effectiveTab === 'unity' && (
            <UnityPanel
              isVisible={rightSidebarOpen && effectiveTab === 'unity'}
              section={unitySection}
            />
          )}
          {/* Remount on plugin changes so an old iframe cannot post through the next plugin's rebound bridge. */}
          {isPluginPanelTabKey(effectiveTab) && (
            <PluginPanel key={effectiveTab} tabKey={effectiveTab} />
          )}
        </Suspense>
      </RecoverableRenderErrorBoundary>
    </div>
  )
}
