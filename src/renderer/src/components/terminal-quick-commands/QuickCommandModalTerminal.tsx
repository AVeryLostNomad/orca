import { useEffect, useState } from 'react'
import { Loader2, XIcon } from 'lucide-react'
import TerminalPane from '@/components/terminal-pane/TerminalPane'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  ORCA_TERMINAL_COMMAND_FINISHED_EVENT,
  type TerminalCommandFinishedEventDetail
} from '@/hooks/terminal-command-finished-event'
import { useAppStore } from '@/store'
import type { QuickCommandModalRequest } from '@/store/slices/quick-command-modal'
import { translate } from '@/i18n/i18n'
import { flattenTerminalQuickCommand } from '../../../../shared/terminal-quick-commands'
import { FOLDER_WORKSPACE_INSTANCE_SEPARATOR } from '../../../../shared/worktree/id'

/**
 * Modal host for `mode: 'modal'` quick commands: an ephemeral terminal over the
 * workspace that runs one command and closes as soon as its shell exits.
 *
 * The backing tab lives under `<realWorkspaceId>::workspace:<uuid>` rather than
 * the real workspace id: no workspace surface renders that key (no tab-bar
 * entry, no double TerminalPane mount, dropped at session hydration), while the
 * real-id prefix keeps repo-based routing (SSH connection, execution host,
 * runtime env) and main's filesystem cwd anchoring identical to a normal tab.
 */
export function QuickCommandModalTerminal(): React.JSX.Element {
  const request = useAppStore((s) => s.quickCommandModal)
  const closeQuickCommandModal = useAppStore((s) => s.closeQuickCommandModal)

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) {
          closeQuickCommandModal()
        }
      }}
    >
      {request ? (
        <QuickCommandModalTerminalContent
          key={request.requestId}
          request={request}
          onClose={closeQuickCommandModal}
        />
      ) : null}
    </Dialog>
  )
}

function QuickCommandModalTerminalContent({
  request,
  onClose
}: {
  request: QuickCommandModalRequest
  onClose: () => void
}): React.JSX.Element {
  const { command, worktreeId, cwd, requestId } = request
  const modalWorktreeId = `${worktreeId}${FOLDER_WORKSPACE_INSTANCE_SEPARATOR}${requestId}`
  const createTab = useAppStore((s) => s.createTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const setActiveTabForWorktree = useAppStore((s) => s.setActiveTabForWorktree)
  const setTabCustomTitle = useAppStore((s) => s.setTabCustomTitle)
  const queueTabStartupCommand = useAppStore((s) => s.queueTabStartupCommand)
  const [tabId, setTabId] = useState<string | null>(null)

  // Why: the sole-pane newborn guard swallows onPtyExit for a fresh PTY the
  // user never typed into, and most quick commands leave the shell alive at a
  // prompt anyway. OSC 133;D is the reliable "command is done" signal, scoped
  // here by the per-launch worktree id.
  useEffect(() => {
    const handleCommandFinished = (event: Event): void => {
      const detail = (event as CustomEvent<TerminalCommandFinishedEventDetail>).detail
      if (detail?.worktreeId === modalWorktreeId) {
        onClose()
      }
    }
    window.addEventListener(ORCA_TERMINAL_COMMAND_FINISHED_EVENT, handleCommandFinished)
    return () => {
      window.removeEventListener(ORCA_TERMINAL_COMMAND_FINISHED_EVENT, handleCommandFinished)
    }
  }, [modalWorktreeId, onClose])

  useEffect(() => {
    const tab = createTab(modalWorktreeId, undefined, undefined, {
      activate: false,
      recordInteraction: false,
      quickCommandLabel: command.label
    })
    setActiveTabForWorktree(modalWorktreeId, tab.id)
    setTabCustomTitle(tab.id, command.label, { recordInteraction: false })
    queueTabStartupCommand(tab.id, { command: flattenTerminalQuickCommand(command).command })
    setTabId(tab.id)
    return () => {
      // Why: dismissing the modal must not leave its shell running invisibly.
      closeTab(tab.id, { recordInteraction: false, reason: 'cleanup' })
    }
  }, [
    closeTab,
    command,
    createTab,
    modalWorktreeId,
    queueTabStartupCommand,
    setActiveTabForWorktree,
    setTabCustomTitle
  ])

  return (
    <DialogContent
      aria-describedby={undefined}
      className="flex h-[min(70vh,36rem)] w-[min(92vw,56rem)] max-w-none flex-col gap-0 p-0 sm:max-w-none"
      showCloseButton={false}
      // Why: Esc must reach a TUI running in the terminal, not dismiss the
      // dialog; xterm has already consumed the keystroke when Radix sees it.
      onEscapeKeyDown={(e) => {
        if (e.target instanceof HTMLElement && e.target.closest('.xterm')) {
          e.preventDefault()
        }
      }}
      // Why: the terminal takes focus once the PTY paints; Radix's default
      // focus target would tug it away first.
      onOpenAutoFocus={(e) => e.preventDefault()}
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2.5 py-2">
        <DialogTitle className="text-[12px] leading-normal font-semibold">
          {command.label}
        </DialogTitle>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="ml-auto opacity-70 hover:opacity-100"
          onClick={onClose}
        >
          <XIcon className="size-4" />
          <span className="sr-only">
            {translate(
              'auto.components.terminal.quick.commands.QuickCommandModalTerminal.e36e878bae',
              'Close'
            )}
          </span>
        </Button>
      </div>
      <div className="relative min-h-0 flex-1 bg-background">
        {tabId ? (
          <TerminalPane
            tabId={tabId}
            worktreeId={modalWorktreeId}
            cwd={cwd ?? undefined}
            isActive
            isVisible
            showSplitButton={false}
            onPtyExit={() => {
              closeTab(tabId, { recordInteraction: false, reason: 'pty-exit' })
              onClose()
            }}
            onCloseTab={() => {
              closeTab(tabId, { recordInteraction: false, reason: 'cleanup' })
              onClose()
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {translate(
              'auto.components.terminal.quick.commands.QuickCommandModalTerminal.b60b83341f',
              'Starting terminal...'
            )}
          </div>
        )}
      </div>
    </DialogContent>
  )
}
