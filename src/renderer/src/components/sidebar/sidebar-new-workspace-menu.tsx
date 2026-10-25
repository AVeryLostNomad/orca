import React, { useCallback, useState } from 'react'
import { FlaskConical, GitBranchPlus, Plus } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useOptionalShortcutLabel } from '@/hooks/useShortcutLabel'
import { translate } from '@/i18n/i18n'
import { isPairedWebClientWindow } from '@/lib/desktop-window-chrome'
import { getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { openWorkspaceCreationComposerWithTourHandoff } from '../contextual-tours/workspace-creation-tour-handoff'
import { createPrototypeAndOpen } from './prototype-actions'

function isWorkspaceCreationTourHandoffPending(): boolean {
  const state = useAppStore.getState()
  return (
    state.activeContextualTourId === 'workspace-agent-sessions' &&
    state.activeContextualTourStepIndex === 1
  )
}

export function SidebarNewWorkspaceMenu(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const newWorktreeShortcutLabel = useOptionalShortcutLabel('workspace.create')
  // Why: prototypes are provisioned on this machine's disk, so hide them when a remote runtime owns projects.
  const canCreatePrototype = useAppStore(
    (s) => !isPairedWebClientWindow() && getActiveRuntimeTarget(s.settings).kind === 'local'
  )

  const handleOpenChange = useCallback((next: boolean) => {
    // Why: the parallel-work tour highlights this control and expects a click to open the composer directly.
    if (next && isWorkspaceCreationTourHandoffPending()) {
      openWorkspaceCreationComposerWithTourHandoff()
      return
    }
    setOpen(next)
  }, [])

  const label = translate('auto.components.sidebar.SidebarHeader.92154beb7e', 'New workspace')

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              className="text-muted-foreground"
              aria-label={label}
              data-contextual-tour-target="workspace-create-control"
            >
              <Plus className="size-3.5" strokeWidth={2.25} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {label}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="bottom" align="end" sideOffset={6} className="min-w-48">
        <DropdownMenuItem onSelect={openWorkspaceCreationComposerWithTourHandoff}>
          <GitBranchPlus className="size-3.5" />
          {translate('auto.components.sidebar.SidebarHeader.newWorktree', 'New Worktree')}
          {newWorktreeShortcutLabel ? (
            <DropdownMenuShortcut>{newWorktreeShortcutLabel}</DropdownMenuShortcut>
          ) : null}
        </DropdownMenuItem>
        {canCreatePrototype ? (
          <DropdownMenuItem onSelect={() => void createPrototypeAndOpen()}>
            <FlaskConical className="size-3.5" />
            {translate('auto.components.sidebar.SidebarHeader.newPrototype', 'New Prototype')}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
