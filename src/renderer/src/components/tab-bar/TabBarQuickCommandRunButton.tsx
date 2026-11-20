import { PanelTop, Play, SquareTerminal } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import {
  getTerminalQuickCommandBody,
  isTerminalAgentQuickCommand
} from '../../../../shared/terminal-quick-commands'
import { getAgentLabel } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import type { HostedTerminalQuickCommand } from '@/hooks/use-terminal-quick-command-hosts'
import type { TerminalQuickCommandMode } from '../../../../shared/terminal-quick-command-types'

/** Split-button play half: click runs the most recent command; right-click picks tab or popup. */
export function TabBarQuickCommandRunButton({
  mostRecent,
  className,
  onRun
}: {
  mostRecent: HostedTerminalQuickCommand | null
  className: string
  onRun: (entry: HostedTerminalQuickCommand, mode?: TerminalQuickCommandMode) => void
}): React.JSX.Element {
  return (
    <ContextMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <ContextMenuTrigger asChild disabled={!mostRecent}>
            <button
              type="button"
              onClick={() => mostRecent && onRun(mostRecent)}
              disabled={!mostRecent}
              className={className}
              aria-label={
                mostRecent
                  ? translate(
                      'auto.components.tab.bar.TabBarQuickCommandsButton.b775303755',
                      'Run quick command: {{value0}}',
                      { value0: mostRecent.command.label }
                    )
                  : translate(
                      'auto.components.tab.bar.TabBarQuickCommandsButton.85482c57bc',
                      'Run quick command'
                    )
              }
            >
              <Play className="size-3 shrink-0" fill="currentColor" strokeWidth={0} />
              {/* Why: keyed to the strip's width, not focus, so narrow split groups stay icon-only without reflowing. */}
              <span className="max-w-[160px] truncate text-[12px] font-medium @max-[480px]/tab-strip:hidden">
                {mostRecent?.command.label ??
                  translate('auto.components.tab.bar.TabBarQuickCommandsButton.7b1c9d6ae1', 'Run')}
              </span>
            </button>
          </ContextMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {mostRecent
            ? isTerminalAgentQuickCommand(mostRecent.command)
              ? translate(
                  'auto.components.tab.bar.TabBarQuickCommandsButton.77ac113df0',
                  'Start {{value0}}: {{value1}}',
                  {
                    value0: getAgentLabel(mostRecent.command.agent),
                    value1: getTerminalQuickCommandBody(mostRecent.command)
                  }
                )
              : translate(
                  'auto.components.tab.bar.TabBarQuickCommandsButton.37e1bb90ce',
                  'Run: {{value0}}',
                  { value0: getTerminalQuickCommandBody(mostRecent.command) }
                )
            : translate(
                'auto.components.tab.bar.TabBarQuickCommandsButton.85482c57bc',
                'Run quick command'
              )}
        </TooltipContent>
      </Tooltip>
      {mostRecent ? (
        <TabBarQuickCommandRunModeMenuContent
          entry={mostRecent}
          onRun={(mode) => onRun(mostRecent, mode)}
        />
      ) : null}
    </ContextMenu>
  )
}

function TabBarQuickCommandRunModeMenuContent({
  entry,
  onRun
}: {
  entry: HostedTerminalQuickCommand
  onRun: (mode: TerminalQuickCommandMode) => void
}): React.JSX.Element {
  // Agent launches always open their own tab; the popup only hosts plain shell commands.
  const canRunInPopup = !isTerminalAgentQuickCommand(entry.command)
  return (
    <ContextMenuContent className="min-w-48">
      <ContextMenuItem onSelect={() => onRun('tab')}>
        <SquareTerminal className="size-3.5" />
        {translate('auto.components.tab.bar.TabBarQuickCommandsButton.runInTab', 'Run in new tab')}
      </ContextMenuItem>
      <ContextMenuItem disabled={!canRunInPopup} onSelect={() => onRun('modal')}>
        <PanelTop className="size-3.5" />
        {translate('auto.components.tab.bar.TabBarQuickCommandsButton.runInPopup', 'Run in popup')}
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
