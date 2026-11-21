import { useCallback } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { useWorktreeRuntimeTarget } from '@/runtime/use-worktree-runtime-target'
import {
  canStopWorkspacePort,
  killWorkspacePortForTarget,
  openWorkspacePortInBrowser,
  refreshWorkspacePortScanAfterStop
} from '@/lib/workspace-port-actions'
import { useLocalhostLabelRouteForPort } from '@/lib/workspace-port-localhost-label-selector'
import { addressForPort } from '@/lib/workspace-port-urls'
import { translate } from '@/i18n/i18n'
import type { WorkspacePort } from '../../../../shared/workspace-ports'

/** Open / copy / stop for one listening port, shared by menu-style port surfaces. */
export function useWorkspacePortActions(port: WorkspacePort): {
  open: (target: 'orca' | 'system') => void
  copy: () => void
  stop: () => void
  canStop: boolean
  address: string
} {
  const localhostLabelRoute = useLocalhostLabelRouteForPort(port)
  const createBrowserTab = useAppStore((s) => s.createBrowserTab)
  const setRemoteBrowserPageHandle = useAppStore((s) => s.setRemoteBrowserPageHandle)
  const replaceWorkspacePortScans = useAppStore((s) => s.replaceWorkspacePortScans)
  const setWorkspacePortScanRefreshing = useAppStore((s) => s.setWorkspacePortScanRefreshing)
  const recordFeatureInteraction = useAppStore((s) => s.recordFeatureInteraction)
  const runtimeTarget = useWorktreeRuntimeTarget(
    port.kind === 'workspace' ? port.owner.worktreeId : null
  )
  const address = addressForPort(port)

  const open = useCallback(
    (target: 'orca' | 'system') => {
      recordFeatureInteraction('ports')
      void openWorkspacePortInBrowser({
        port,
        runtimeTarget,
        createBrowserTab,
        setRemoteBrowserPageHandle,
        openInOrcaBrowser: target === 'orca',
        localhostLabelRoute
      }).then((result) => {
        if (!result.ok) {
          toast.error(
            translate(
              'auto.components.ports.useWorkspacePortActions.openFailed',
              'Failed to open browser'
            ),
            { description: result.reason }
          )
        }
      })
    },
    [
      createBrowserTab,
      localhostLabelRoute,
      port,
      recordFeatureInteraction,
      runtimeTarget,
      setRemoteBrowserPageHandle
    ]
  )

  const copy = useCallback(() => {
    recordFeatureInteraction('ports')
    void window.api.ui.writeClipboardText(address)
    toast.success(
      translate('auto.components.ports.useWorkspacePortActions.copied', 'Copied {{value0}}', {
        value0: address
      })
    )
  }, [address, recordFeatureInteraction])

  const stop = useCallback(() => {
    if (!canStopWorkspacePort(port)) {
      return
    }
    recordFeatureInteraction('ports')
    void (async () => {
      const result = await killWorkspacePortForTarget(runtimeTarget, {
        repoId: port.owner.repoId,
        pid: port.pid,
        port: port.port
      })
      if (!result.ok) {
        toast.error(result.reason)
        return
      }
      toast.success(
        translate(
          'auto.components.ports.useWorkspacePortActions.stopped',
          'Stopped process on {{value0}}',
          { value0: port.port }
        )
      )
      await refreshWorkspacePortScanAfterStop({
        runtimeTarget,
        replaceWorkspacePortScans,
        getWorkspacePortScansByKey: () => useAppStore.getState().workspacePortScansByKey,
        setWorkspacePortScanRefreshing
      })
    })()
  }, [
    port,
    recordFeatureInteraction,
    replaceWorkspacePortScans,
    runtimeTarget,
    setWorkspacePortScanRefreshing
  ])

  return { open, copy, stop, canStop: canStopWorkspacePort(port), address }
}
