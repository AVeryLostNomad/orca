import React, { useCallback, useState } from 'react'
import { AppWindow, Copy, ExternalLink, Globe, Square } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { getWorkspacePortsByWorktreeId } from '@/lib/workspace-port-groups'
import { refreshWorkspacePortScanForTarget } from '@/lib/workspace-port-scan-refresh'
import { useWorktreeRuntimeTarget } from '@/runtime/use-worktree-runtime-target'
import { translate } from '@/i18n/i18n'
import type { WorkspacePort } from '../../../../shared/workspace-ports'
import { useWorkspacePortActions } from './use-workspace-port-actions'

const EMPTY_PORTS: readonly WorkspacePort[] = []

const PILL_CLASS =
  'my-auto ml-1 flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-accent data-[state=open]:text-foreground'

// SAFETY: React's CSSProperties lacks Electron's -webkit-app-region; the tab strip is a window drag region.
const NO_DRAG_STYLE = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

/** Live dev servers this workspace's processes are listening on, with open/stop shortcuts. */
export function WorktreePortsToolbar({
  worktreeId
}: {
  worktreeId: string
}): React.JSX.Element | null {
  const visible = useAppStore(
    (s) => s.activeView === 'terminal' && s.activeWorktreeId === worktreeId
  )
  const ports = useAppStore(
    (s) =>
      getWorkspacePortsByWorktreeId(s.workspacePortScan?.result ?? null).get(worktreeId) ??
      EMPTY_PORTS
  )
  if (!visible || ports.length === 0) {
    return null
  }
  return <WorktreePortsToolbarView worktreeId={worktreeId} ports={ports} />
}

export function WorktreePortsToolbarView({
  worktreeId,
  ports
}: {
  worktreeId: string
  ports: readonly WorkspacePort[]
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const runtimeTarget = useWorktreeRuntimeTarget(worktreeId)
  const replaceWorkspacePortScans = useAppStore((s) => s.replaceWorkspacePortScans)
  const sorted = [...ports].sort((a, b) => a.port - b.port)
  const first = sorted[0]!
  const summary =
    sorted.length === 1
      ? `:${first.port}`
      : translate('auto.components.ports.WorktreePortsToolbar.serverCount', '{{value0}} servers', {
          value0: sorted.length
        })

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen)
      if (nextOpen && runtimeTarget) {
        // Refresh on open so a server stopped since the last 30 s poll doesn't linger in the list.
        void refreshWorkspacePortScanForTarget({
          runtimeTarget,
          replaceWorkspacePortScans,
          getWorkspacePortScansByKey: () => useAppStore.getState().workspacePortScansByKey
        })
      }
    },
    [replaceWorkspacePortScans, runtimeTarget]
  )

  return (
    <div className="flex shrink-0 items-center" style={NO_DRAG_STYLE}>
      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button type="button" className={PILL_CLASS} data-testid="worktree-ports-toolbar">
                <span className="relative flex size-2 shrink-0">
                  <span className="absolute inline-flex size-full rounded-full bg-emerald-500/60 motion-safe:animate-ping" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                <Globe className="size-3.5" />
                <span className="font-mono tabular-nums">{summary}</span>
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {translate(
              'auto.components.ports.WorktreePortsToolbar.tooltip',
              'Web servers running in this workspace'
            )}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="min-w-60">
          {sorted.map((port, index) => (
            <React.Fragment key={port.id}>
              {index > 0 ? <DropdownMenuSeparator /> : null}
              <PortMenuSection port={port} />
            </React.Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function PortMenuSection({ port }: { port: WorkspacePort }): React.JSX.Element {
  const { open, copy, stop, canStop, address } = useWorkspacePortActions(port)
  const processLabel = port.processName ?? (port.pid ? `PID ${port.pid}` : null)
  return (
    <div role="group">
      <DropdownMenuLabel className="flex items-baseline gap-2 text-xs">
        <span className="font-mono tabular-nums text-foreground">{address}</span>
        {processLabel ? (
          <span className="truncate font-normal text-muted-foreground">{processLabel}</span>
        ) : null}
      </DropdownMenuLabel>
      <DropdownMenuItem onSelect={() => open('orca')}>
        <AppWindow className="size-3.5" />
        {translate('auto.components.ports.WorktreePortsToolbar.openInOrca', 'Open in browser tab')}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => open('system')}>
        <ExternalLink className="size-3.5" />
        {translate(
          'auto.components.ports.WorktreePortsToolbar.openInSystem',
          'Open in system browser'
        )}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={copy}>
        <Copy className="size-3.5" />
        {translate('auto.components.ports.WorktreePortsToolbar.copyAddress', 'Copy address')}
      </DropdownMenuItem>
      <DropdownMenuItem variant="destructive" disabled={!canStop} onSelect={stop}>
        <Square className="size-3.5" />
        {translate('auto.components.ports.WorktreePortsToolbar.stop', 'Stop process')}
      </DropdownMenuItem>
    </div>
  )
}
