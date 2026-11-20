import { useId, type MouseEvent, type PointerEvent } from 'react'
import { Check, Copy, PanelTop, Pencil, Play, SquareTerminal, Trash2, Zap } from 'lucide-react'
import {
  getTerminalQuickCommandBody,
  getTerminalQuickCommandMode,
  isTerminalAgentQuickCommand
} from '../../../../shared/terminal-quick-commands'
import type { TerminalQuickCommandMode } from '../../../../shared/terminal-quick-command-types'
import { AgentIcon, getAgentLabel } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import { useClipboardTextCopyFeedback } from '@/hooks/use-clipboard-text-copy-feedback'
import type { HostedTerminalQuickCommand } from '@/hooks/use-terminal-quick-command-hosts'
import { cn } from '@/lib/utils'

type TabBarQuickCommandItemProps = {
  entry: HostedTerminalQuickCommand
  showHostLabel: boolean
  selected?: boolean
  position?: number
  totalCount?: number
  onHighlight?: () => void
  onActiveElementChange?: (element: HTMLDivElement | null) => void
  onRun: () => void
  /** Run once in the other mode (tab ↔ popup) without changing the saved command. */
  onRunInMode?: (mode: TerminalQuickCommandMode) => void
  onEdit: () => void
  onDelete: () => void
}

function stopRowSelect(event: MouseEvent | PointerEvent): void {
  // Why: nested actions must preserve search focus without running the command.
  event.preventDefault()
  event.stopPropagation()
}

export function TabBarQuickCommandItem({
  entry,
  showHostLabel,
  selected = false,
  position,
  totalCount,
  onHighlight,
  onActiveElementChange,
  onRun,
  onRunInMode,
  onEdit,
  onDelete
}: TabBarQuickCommandItemProps): React.JSX.Element {
  const id = useId()
  const { command } = entry
  const isAuto = entry.source?.kind === 'package-json'
  const alternateMode: TerminalQuickCommandMode | null = isTerminalAgentQuickCommand(command)
    ? null
    : getTerminalQuickCommandMode(command) === 'modal'
      ? 'tab'
      : 'modal'
  const alternateModeLabel =
    alternateMode === 'modal'
      ? translate('auto.components.tab.bar.TabBarQuickCommandsButton.runInPopup', 'Run in popup')
      : translate('auto.components.tab.bar.TabBarQuickCommandsButton.runInTab', 'Run in new tab')
  const body = getTerminalQuickCommandBody(command)
  const { canCopy, copyText, status } = useClipboardTextCopyFeedback(body)

  const copyLabel =
    status === 'copied'
      ? translate('auto.components.tab.bar.TabBarQuickCommandsButton.8d525e5f15', 'Copied')
      : status === 'failed'
        ? translate('auto.components.tab.bar.TabBarQuickCommandsButton.53b17a4b1b', "Couldn't copy")
        : canCopy
          ? translate(
              'auto.components.tab.bar.TabBarQuickCommandsButton.a9a564b7e7',
              'Copy {{value0}}',
              { value0: command.label }
            )
          : translate(
              'auto.components.tab.bar.TabBarQuickCommandsButton.69a1441a21',
              'Nothing to copy'
            )

  return (
    <div
      ref={selected ? onActiveElementChange : undefined}
      id={id}
      role="option"
      aria-selected={selected}
      aria-posinset={position}
      aria-setsize={totalCount}
      data-selected={selected}
      data-value={entry.key}
      onPointerMove={onHighlight}
      onClick={onRun}
      className="group/qc mx-1 my-0.5 flex cursor-pointer items-center gap-2 rounded-[7px] px-2 py-1.5 text-[12px] leading-5 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
    >
      {isTerminalAgentQuickCommand(command) ? (
        <span className="shrink-0 text-muted-foreground">
          <AgentIcon agent={command.agent} size={12} />
        </span>
      ) : (
        <Play
          className="size-3 shrink-0 text-muted-foreground"
          fill="currentColor"
          strokeWidth={0}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
            {command.label}
          </span>
          {isAuto ? (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 rounded border border-border/60 px-1 text-[10px] leading-4 text-muted-foreground"
              title={translate(
                'auto.components.tab.bar.TabBarQuickCommandsButton.autoFromPackageJson',
                'Detected automatically from {{value0}}',
                { value0: entry.source?.packageJsonPath ?? 'package.json' }
              )}
            >
              <Zap className="size-2.5" />
              {entry.source?.packageJsonPath === 'package.json'
                ? translate('auto.components.tab.bar.TabBarQuickCommandsButton.autoBadge', 'auto')
                : entry.source?.packageJsonPath.replace(/\/package\.json$/, '')}
            </span>
          ) : null}
          {showHostLabel && !isAuto ? (
            <span className="shrink-0 text-[11px] text-muted-foreground">{entry.hostLabel}</span>
          ) : null}
        </span>
        <span className="block truncate font-mono text-[11px] text-muted-foreground">
          {isTerminalAgentQuickCommand(command)
            ? `${getAgentLabel(command.agent)}: ${command.prompt}`
            : command.command}
        </span>
      </span>
      <span
        role="group"
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.stopPropagation()
          }
        }}
        aria-label={translate(
          'auto.components.tab.bar.TabBarQuickCommandsButton.192a4616a5',
          'Quick command actions'
        )}
        className="flex shrink-0 items-center gap-0.5 can-hover:opacity-0 transition-opacity group-hover/qc:opacity-100 group-data-[selected=true]/qc:opacity-100"
      >
        {alternateMode && onRunInMode ? (
          <button
            type="button"
            onPointerDown={stopRowSelect}
            onClick={(event) => {
              stopRowSelect(event)
              onRunInMode(alternateMode)
            }}
            className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={alternateModeLabel}
            title={alternateModeLabel}
          >
            {alternateMode === 'modal' ? (
              <PanelTop className="size-3" />
            ) : (
              <SquareTerminal className="size-3" />
            )}
          </button>
        ) : null}
        <button
          type="button"
          disabled={!canCopy}
          onPointerDown={stopRowSelect}
          onClick={(event) => {
            stopRowSelect(event)
            void copyText()
          }}
          className={cn(
            'cursor-pointer rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
            status === 'copied' && 'text-status-success',
            status === 'failed' && 'text-destructive'
          )}
          aria-label={copyLabel}
          title={copyLabel}
        >
          {status === 'copied' ? <Check className="size-3" /> : <Copy className="size-3" />}
        </button>
        {isAuto ? null : (
          <>
            <button
              type="button"
              onPointerDown={stopRowSelect}
              onClick={(event) => {
                stopRowSelect(event)
                onEdit()
              }}
              className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={translate(
                'auto.components.tab.bar.TabBarQuickCommandsButton.15529ede69',
                'Edit {{value0}}',
                { value0: command.label }
              )}
            >
              <Pencil className="size-3" />
            </button>
            <button
              type="button"
              onPointerDown={stopRowSelect}
              onClick={(event) => {
                stopRowSelect(event)
                onDelete()
              }}
              className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
              aria-label={translate(
                'auto.components.tab.bar.TabBarQuickCommandsButton.196593b6a9',
                'Remove {{value0}}',
                { value0: command.label }
              )}
            >
              <Trash2 className="size-3" />
            </button>
          </>
        )}
      </span>
    </div>
  )
}
