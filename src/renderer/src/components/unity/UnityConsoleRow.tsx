import type React from 'react'
import { ChevronRight, CircleX, Info, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { basename } from '@/lib/path'
import { translate } from '@/i18n/i18n'
import {
  firstLine,
  unityConsoleSeverity,
  type UnityConsoleRow as ConsoleRow,
  type UnityConsoleSeverity
} from './unity-console-model'
import { openUnityFileLocation } from './unity-open-location'

export const UNITY_SEVERITY_STYLE: Record<
  UnityConsoleSeverity,
  { Icon: React.ComponentType<{ className?: string }>; className: string }
> = {
  log: { Icon: Info, className: 'text-muted-foreground' },
  warning: { Icon: TriangleAlert, className: 'text-status-warning' },
  error: { Icon: CircleX, className: 'text-destructive' }
}

function formatTimestamp(timestamp: string | undefined): string {
  if (!timestamp) {
    return ''
  }
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return timestamp
  }
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export function UnityConsoleRow({
  row,
  expanded,
  onToggleExpanded,
  measureRef,
  index
}: {
  row: ConsoleRow
  expanded: boolean
  onToggleExpanded: () => void
  measureRef: (element: HTMLElement | null) => void
  index: number
}): React.JSX.Element {
  const { record, count } = row
  const severity = unityConsoleSeverity(record.level)
  const { Icon, className: iconClassName } = UNITY_SEVERITY_STYLE[severity]
  const file = record.file
  const location = file ? `${basename(file)}${record.line ? `:${record.line}` : ''}` : null
  const detailId = `unity-console-detail-${row.key}`

  return (
    <div ref={measureRef} data-index={index} className="border-b border-border/50">
      <div className="group flex min-h-7 items-start gap-1 px-1.5 py-1 hover:bg-accent">
        <button
          type="button"
          className="mt-px flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-controls={detailId}
          aria-label={
            expanded
              ? translate('auto.components.unity.UnityConsoleRow.collapseEntry', 'Collapse entry')
              : translate('auto.components.unity.UnityConsoleRow.expandEntry', 'Expand entry')
          }
        >
          <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
        </button>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
          onClick={() => (file ? openUnityFileLocation(file, record.line) : onToggleExpanded())}
        >
          <Icon className={cn('mt-0.5 size-3.5 shrink-0', iconClassName)} />
          <span className="min-w-0 flex-1 truncate text-xs leading-5 text-foreground">
            {firstLine(record.message)}
          </span>
        </button>
        {count > 1 ? (
          <span
            className="mt-0.5 shrink-0 rounded-full bg-secondary px-1.5 text-3xs leading-4 font-medium text-secondary-foreground tabular-nums"
            aria-label={translate(
              'auto.components.unity.UnityConsoleRow.occurrences',
              '{{count}} occurrences',
              { count }
            )}
          >
            {count}
          </span>
        ) : null}
        <span className="shrink-0 text-3xs leading-5 text-muted-foreground tabular-nums">
          {formatTimestamp(record.timestamp)}
        </span>
      </div>
      {expanded ? (
        <div id={detailId} className="space-y-1.5 pr-2 pb-2 pl-8">
          <pre className="font-mono text-2xs whitespace-pre-wrap break-words text-foreground">
            {record.message}
          </pre>
          {record.stackTrace ? (
            <pre className="font-mono text-2xs whitespace-pre-wrap break-words text-muted-foreground">
              {record.stackTrace}
            </pre>
          ) : null}
          {file && location ? (
            <button
              type="button"
              className="font-mono text-2xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => openUnityFileLocation(file, record.line)}
            >
              {location}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
