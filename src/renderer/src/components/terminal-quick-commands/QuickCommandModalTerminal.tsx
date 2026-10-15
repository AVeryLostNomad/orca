import { useEffect, useRef, useState } from 'react'
import { Loader2, XIcon } from 'lucide-react'
import TerminalPane, { type TerminalPaneHandle } from '@/components/terminal-pane/TerminalPane'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useAppStore } from '@/store'
import type { QuickCommandModalRequest } from '@/store/slices/quick-command-modal'
import { translate } from '@/i18n/i18n'
import { flattenTerminalQuickCommand } from '../../../../shared/terminal-quick-commands'
import { FOLDER_WORKSPACE_INSTANCE_SEPARATOR } from '../../../../shared/worktree/id'
import { isProvenProcessExit } from '../../../../shared/terminal-exit-cause'
import { closeIfEscapeUnconsumed, useCloseOnAnyKey } from './quick-command-modal-dismissal'

/**
 * Modal host for `mode: 'modal'` quick commands: an ephemeral terminal over the
 * workspace whose shell exits with its one command, then waits for any key so
 * its output stays scrollable and selectable until dismissed.
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
  const { command, startupCommand, worktreeId, cwd, requestId } = request
  const title =
    command?.label ??
    translate(
      'auto.components.terminal.quick.commands.QuickCommandModalTerminal.popupTitle',
      'Popup Terminal'
    )
  const modalWorktreeId = `${worktreeId}${FOLDER_WORKSPACE_INSTANCE_SEPARATOR}${requestId}`
  const createTab = useAppStore((s) => s.createTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const setActiveTabForWorktree = useAppStore((s) => s.setActiveTabForWorktree)
  const setTabCustomTitle = useAppStore((s) => s.setTabCustomTitle)
  const queueTabStartupCommand = useAppStore((s) => s.queueTabStartupCommand)
  const [tabId, setTabId] = useState<string | null>(null)
  const paneRef = useRef<TerminalPaneHandle>(null)
  const [exitCode, setExitCode] = useState<number | null>(null)
  // Why: some exit paths keep the pane mounted without calling back, but every
  // proven exit drops the tab's PTY binding.
  const livePtyCount = useAppStore((s) => (tabId ? (s.ptyIdsByTabId[tabId]?.length ?? 0) : 0))
  const [sawPty, setSawPty] = useState(false)
  if (livePtyCount > 0 && !sawPty) {
    setSawPty(true)
  }
  const taskFinished = Boolean(command) && ((sawPty && livePtyCount === 0) || exitCode !== null)
  useCloseOnAnyKey(taskFinished, onClose)

  useEffect(() => {
    const tab = createTab(modalWorktreeId, undefined, undefined, {
      activate: false,
      recordInteraction: false,
      ...(command ? { quickCommandLabel: command.label } : {})
    })
    setActiveTabForWorktree(modalWorktreeId, tab.id)
    if (command) {
      setTabCustomTitle(tab.id, command.label, { recordInteraction: false })
      queueTabStartupCommand(tab.id, {
        command: startupCommand ?? flattenTerminalQuickCommand(command).command
      })
    }
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
    setTabCustomTitle,
    startupCommand
  ])

  return (
    <DialogContent
      aria-describedby={undefined}
      className="flex h-[min(70vh,36rem)] w-[min(92vw,56rem)] max-w-none flex-col gap-0 p-0 sm:max-w-none"
      showCloseButton={false}
      onEscapeKeyDown={(e) => {
        if (taskFinished || !(e.target instanceof HTMLElement) || !e.target.closest('.xterm')) {
          return
        }
        e.preventDefault()
        closeIfEscapeUnconsumed(paneRef.current, requestId, onClose)
      }}
      // Why: the terminal takes focus once the PTY paints; Radix's default
      // focus target would tug it away first.
      onOpenAutoFocus={(e) => e.preventDefault()}
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2.5 py-2">
        <DialogTitle className="text-[12px] leading-normal font-semibold">{title}</DialogTitle>
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
            ref={paneRef}
            tabId={tabId}
            worktreeId={modalWorktreeId}
            cwd={cwd ?? undefined}
            isActive
            isVisible
            showSplitButton={false}
            onPtyExit={(_ptyId, code) => {
              // Why: keep quick-command output visible after exit; unmount cleans up the tab.
              if (command) {
                // Why: a lost host is not a finished task; only a proven exit ends it.
                if (code === undefined || isProvenProcessExit(code)) {
                  setExitCode(code ?? 0)
                }
                return
              }
              closeTab(tabId, { recordInteraction: false, reason: 'pty-exit' })
              onClose()
            }}
            onCloseTab={() => {
              closeTab(tabId, { recordInteraction: false, reason: 'cleanup' })
              onClose()
            }}
            {...(command ? { onProcessFailed: setExitCode } : {})}
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
      {taskFinished ? (
        <div className="flex shrink-0 items-center gap-1.5 border-t border-border px-2.5 py-1.5 text-[12px] text-muted-foreground">
          {exitCode !== null && exitCode !== 0 ? (
            <span className="text-destructive">
              {translate(
                'auto.components.terminal.quick.commands.QuickCommandModalTerminal.taskFailed',
                'Exited with code {{code}}.'
              ).replace('{{code}}', String(exitCode))}
            </span>
          ) : null}
          <span>
            {translate(
              'auto.components.terminal.quick.commands.QuickCommandModalTerminal.pressAnyKey',
              'Task finished. Press any key to close.'
            )}
          </span>
        </div>
      ) : null}
    </DialogContent>
  )
}
