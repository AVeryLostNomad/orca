import React, { useCallback, useState } from 'react'
import {
  AlertTriangle,
  Ellipsis,
  Link2,
  Loader2,
  Pencil,
  Plug,
  PlugZap,
  RefreshCw,
  Settings2,
  Trash2
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useMountedRef } from '@/hooks/useMountedRef'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { sshConnectVerb } from '@/ssh/ssh-connect-verb'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import { runtimePairingRepairRoute } from '../../../../shared/runtime-environments'
import { describeRuntimeCompatBlock } from '../../../../shared/protocol-compat'
import { clearRuntimeCompatibilityCache } from '@/runtime/runtime-rpc-client'
import { unwrapRuntimeRpcResult } from '@/runtime/runtime-rpc-result'
import type { RuntimeStatus } from '../../../../shared/runtime-types'
import type { SidebarHostOption } from './sidebar-host-options'
import { buildHostHeaderMenuModel } from './host-header-menu-items'
import { HostRenameDialog } from './HostRenameDialog'
import { HostRemoveDialog } from './HostRemoveDialog'
import { RuntimeRepairDialog } from '../settings/RuntimeRepairDialog'
import { resolveHostRemoval } from './host-rename-remove'

function blockedTitle(reason: 'client-too-old' | 'server-too-old'): string {
  return reason === 'server-too-old'
    ? translate(
        'auto.components.sidebar.HostSectionHeaderMenu.5b8b4b6a01',
        'Update server required'
      )
    : translate(
        'auto.components.sidebar.HostSectionHeaderMenu.9b3c1d2e44',
        'Update client required'
      )
}

// Shared sidebar hosts route to connection-specific management pages in Settings.
type SidebarHostMenuTarget = Pick<
  SidebarHostOption,
  'id' | 'kind' | 'label' | 'health' | 'compatibility' | 'blockedReason'
>

function openManageHost(host: SidebarHostMenuTarget): void {
  const state = useAppStore.getState()
  if (host.kind === 'runtime') {
    const parsed = parseExecutionHostId(host.id)
    state.openSettingsTarget({
      pane: 'servers',
      repoId: null,
      sectionId: parsed?.kind === 'runtime' ? parsed.environmentId : undefined
    })
  } else if (host.kind === 'ssh') {
    state.openSettingsTarget({ pane: 'ssh', repoId: null, sectionId: 'ssh' })
  } else {
    state.openSettingsTarget({ pane: 'general', repoId: null })
  }
  state.openSettingsPage()
}

export function SidebarHostMenu({ host }: { host: SidebarHostMenuTarget }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [repairOpen, setRepairOpen] = useState(false)
  const mountedRef = useMountedRef()
  const sshStatus = useAppStore((s) => {
    const parsed = parseExecutionHostId(host.id)
    if (parsed?.kind !== 'ssh') {
      return null
    }
    return s.sshConnectionStates.get(parsed.targetId)?.status ?? null
  })

  const parsedHost = parseExecutionHostId(host.id)
  const runtimeEnvironmentId = parsedHost?.kind === 'runtime' ? parsedHost.environmentId : null
  const repairRoute = useAppStore((s) => {
    const environment = s.runtimeEnvironments.find((entry) => entry.id === runtimeEnvironmentId)
    return environment ? runtimePairingRepairRoute(environment) : 'access-link'
  })
  const repairableWithAccessLink = repairRoute === 'access-link'
  const model = buildHostHeaderMenuModel({
    kind: host.kind,
    health: host.health,
    sshConnected: sshStatus === 'connected',
    compatibility: host.compatibility,
    blockedReason: host.blockedReason,
    repairableWithAccessLink
  })
  const removalTarget = resolveHostRemoval(host.id)

  const handleManage = useCallback(() => {
    openManageHost(host)
  }, [host])

  const runSshAction = useCallback(
    async (action: 'connect' | 'disconnect') => {
      const parsed = parseExecutionHostId(host.id)
      if (parsed?.kind !== 'ssh') {
        return
      }
      setBusy(true)
      try {
        await window.api.ssh[action]({ targetId: parsed.targetId })
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : action === 'connect'
              ? translate(
                  'auto.components.sidebar.HostSectionHeaderMenu.2c29e2de68',
                  'Connection failed'
                )
              : translate(
                  'auto.components.sidebar.HostSectionHeaderMenu.bf07aee59e',
                  'Disconnect failed'
                )
        )
      } finally {
        if (mountedRef.current) {
          setBusy(false)
        }
      }
    },
    [mountedRef, host.id]
  )

  const handleCheckConnection = useCallback(async () => {
    const parsed = parseExecutionHostId(host.id)
    if (parsed?.kind !== 'runtime') {
      return
    }
    setBusy(true)
    // Discard cached compatibility so this check re-evaluates version skew.
    clearRuntimeCompatibilityCache(parsed.environmentId)
    // Managed SSH can repair revoked pairing; connect retries it rather than rereading refusal.
    const retryPairing = host.blockedReason === 'access-revoked' && repairRoute === 'ssh'
    try {
      const response = await (
        retryPairing
          ? window.api.runtimeEnvironments.connect
          : window.api.runtimeEnvironments.getStatus
      )({
        selector: parsed.environmentId,
        // Re-pairing needs time for SSH, readiness and two handshakes.
        timeoutMs: retryPairing ? 45_000 : 10_000
      })
      unwrapRuntimeRpcResult<RuntimeStatus>(response)
      // Publish refreshed host status to other pickers through the shared store.
      await useAppStore.getState().readRuntimeHostStatusSnapshots()
      toast.success(
        translate(
          'auto.components.sidebar.HostSectionHeaderMenu.7f1a2b3c4d',
          '{{value0}} is reachable',
          {
            value0: host.label
          }
        )
      )
    } catch (err) {
      // Publish failed probes so the registry cannot retain stale compatibility.
      await useAppStore.getState().readRuntimeHostStatusSnapshots()
      toast.error(
        err instanceof Error
          ? err.message
          : translate(
              'auto.components.sidebar.HostSectionHeaderMenu.2c29e2de68',
              'Connection failed'
            )
      )
    } finally {
      if (mountedRef.current) {
        setBusy(false)
      }
    }
  }, [mountedRef, repairRoute, host.blockedReason, host.id, host.label])

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              className="size-5 shrink-0 text-muted-foreground can-hover:opacity-0 transition-opacity focus-visible:opacity-100 group-hover/host-page:opacity-100 data-[state=open]:opacity-100"
              aria-label={translate(
                'auto.components.sidebar.HostSectionHeaderMenu.4f2c8a9b10',
                'Host actions for {{value0}}',
                { value0: host.label }
              )}
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Ellipsis className="size-3.5" />
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {translate('auto.components.sidebar.HostSectionHeaderMenu.6b7c8d9e10', 'Host actions')}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="bottom" align="start" sideOffset={6} className="w-56">
        {model.actions.includes('runtime-repair') && (
          <>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setRepairOpen(true)}
            >
              <Link2 className="size-3.5" />
              {translate('auto.components.sidebar.HostSectionHeaderMenu.repair', 'Re-pair…')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {model.blocked && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => openManageHost(host)}
                >
                  <AlertTriangle className="size-3.5" />
                  {blockedTitle(model.blocked.reason)}
                </DropdownMenuItem>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={6} className="max-w-72">
                {host.compatibility ? describeRuntimeCompatBlock(host.compatibility) : null}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel className="truncate text-[11px] font-medium text-muted-foreground">
          {host.label}
        </DropdownMenuLabel>
        {model.actions.includes('rename') && (
          <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
            <Pencil className="size-3.5" />
            {translate('auto.components.sidebar.HostSectionHeaderMenu.8d1e2f3a4b', 'Rename…')}
          </DropdownMenuItem>
        )}
        {model.actions.includes('ssh-reconnect') && (
          <DropdownMenuItem onSelect={() => void runSshAction('connect')}>
            <Plug className="size-3.5" />
            {sshConnectVerb(sshStatus)}
          </DropdownMenuItem>
        )}
        {model.actions.includes('ssh-disconnect') && (
          <DropdownMenuItem onSelect={() => void runSshAction('disconnect')}>
            <PlugZap className="size-3.5" />
            {translate('auto.components.sidebar.HostSectionHeaderMenu.59b553e2aa', 'Disconnect')}
          </DropdownMenuItem>
        )}
        {model.actions.includes('runtime-check-connection') && (
          <DropdownMenuItem onSelect={() => void handleCheckConnection()}>
            <RefreshCw className="size-3.5" />
            {translate(
              'auto.components.sidebar.HostSectionHeaderMenu.2d3e4f5a6b',
              'Check connection'
            )}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleManage}>
          <Settings2 className="size-3.5" />
          {translate('auto.components.sidebar.HostSectionHeaderMenu.3c4d5e6f7a', 'Manage host…')}
        </DropdownMenuItem>
        {model.actions.includes('remove') && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setRemoveOpen(true)}
            >
              <Trash2 className="size-3.5" />
              {translate(
                'auto.components.sidebar.HostSectionHeaderMenu.6e7f8a9b0c',
                'Remove host…'
              )}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
      <HostRenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        hostId={host.id}
        derivedLabel={host.label}
      />
      {runtimeEnvironmentId && (
        <RuntimeRepairDialog
          open={repairOpen}
          onOpenChange={setRepairOpen}
          environmentId={runtimeEnvironmentId}
          name={host.label}
        />
      )}
      {removalTarget && (
        <HostRemoveDialog
          open={removeOpen}
          onOpenChange={setRemoveOpen}
          hostId={host.id}
          label={host.label}
          target={removalTarget}
        />
      )}
    </DropdownMenu>
  )
}
