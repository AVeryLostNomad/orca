import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Eraser, ListCollapse, Search, X } from 'lucide-react'
import { ImeInput } from '@/lib/ime-text-field'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { measureVirtualRowRetainingHiddenSize } from '@/hooks/virtualized-hidden-row-measurement'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import {
  buildUnityConsoleView,
  UNITY_CONSOLE_SEVERITIES,
  type UnityConsoleSeverity
} from './unity-console-model'
import { clearUnityConsole, useUnityConsoleSession } from './unity-console-session'
import { UNITY_SEVERITY_STYLE, UnityConsoleRow } from './UnityConsoleRow'

const ROW_ESTIMATED_HEIGHT = 29
const FOLLOW_THRESHOLD_PX = 24

const SEVERITY_LABEL: Record<UnityConsoleSeverity, () => string> = {
  log: () => translate('auto.components.unity.UnityConsoleSection.logs', 'Logs'),
  warning: () => translate('auto.components.unity.UnityConsoleSection.warnings', 'Warnings'),
  error: () => translate('auto.components.unity.UnityConsoleSection.errors', 'Errors')
}

export function UnityConsoleSection({
  projectRoot,
  active
}: {
  projectRoot: string
  /** Visible and connected; polling runs only then. */
  active: boolean
}): React.JSX.Element {
  const session = useUnityConsoleSession(projectRoot, active)
  const [severities, setSeverities] = useState<Record<UnityConsoleSeverity, boolean>>({
    log: true,
    warning: true,
    error: true
  })
  const [query, setQuery] = useState('')
  const [collapse, setCollapse] = useState(false)
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set())
  const scrollRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)

  const view = useMemo(
    () => buildUnityConsoleView(session.records, { severities, query, collapse }),
    [session.records, severities, query, collapse]
  )
  const { rows, counts } = view

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATED_HEIGHT,
    measureElement: measureVirtualRowRetainingHiddenSize,
    overscan: 12,
    getItemKey: (index) => rows[index]?.key ?? `missing:${index}`
  })

  useEffect(() => {
    if (followRef.current && rows.length > 0) {
      virtualizer.scrollToIndex(rows.length - 1, { align: 'end' })
    }
  }, [rows, virtualizer])

  const toggleExpanded = (key: string): void => {
    setExpandedKeys((current) => {
      const next = new Set(current)
      if (!next.delete(key)) {
        next.add(key)
      }
      return next
    })
  }

  const collapseLabel = translate(
    'auto.components.unity.UnityConsoleSection.collapseDuplicates',
    'Collapse duplicates'
  )
  const clearLabel = translate('auto.components.unity.UnityConsoleSection.clear', 'Clear console')
  const filterLabel = translate(
    'auto.components.unity.UnityConsoleSection.filterMessages',
    'Filter messages'
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-sidebar-border px-2 py-1.5">
        {UNITY_CONSOLE_SEVERITIES.map((severity) => {
          const { Icon, className: iconClassName } = UNITY_SEVERITY_STYLE[severity]
          const label = SEVERITY_LABEL[severity]()
          return (
            <Tooltip key={severity}>
              <TooltipTrigger asChild>
                <Toggle
                  size="xs"
                  variant="segmented"
                  pressed={severities[severity]}
                  onPressedChange={(pressed) =>
                    setSeverities((current) => ({ ...current, [severity]: pressed }))
                  }
                  aria-label={label}
                >
                  <span className="flex items-center gap-1 tabular-nums">
                    <Icon
                      className={cn('size-3.5', severities[severity] ? iconClassName : undefined)}
                    />
                    {counts[severity]}
                  </span>
                </Toggle>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                {label}
              </TooltipContent>
            </Tooltip>
          )
        })}
        <div className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="xs"
              variant="segmented"
              pressed={collapse}
              onPressedChange={setCollapse}
              aria-label={collapseLabel}
            >
              <ListCollapse className="size-3.5" />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {collapseLabel}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={clearLabel}
              disabled={session.records.length === 0}
              onClick={() => {
                followRef.current = true
                setExpandedKeys(new Set())
                clearUnityConsole(projectRoot)
              }}
            >
              <Eraser className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {clearLabel}
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="shrink-0 border-b border-sidebar-border px-2 py-1.5">
        <div className="flex h-7 items-center gap-1.5 rounded-md border border-sidebar-border bg-input/50 px-2 focus-within:border-sidebar-ring focus-within:ring-[2px] focus-within:ring-sidebar-ring/30">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <ImeInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={filterLabel}
            aria-label={filterLabel}
            className="min-w-0 flex-1 bg-transparent py-1 text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query) {
                event.stopPropagation()
                setQuery('')
              }
            }}
            spellCheck={false}
          />
          {query ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setQuery('')}
              aria-label={translate(
                'auto.components.unity.UnityConsoleSection.clearFilter',
                'Clear filter'
              )}
            >
              <X className="size-3" />
            </Button>
          ) : null}
        </div>
      </div>
      {session.error ? (
        <div role="alert" className="shrink-0 px-3 py-1.5 text-xs text-destructive break-words">
          {session.error}
        </div>
      ) : null}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-sleek"
        onScroll={(event) => {
          const element = event.currentTarget
          followRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_THRESHOLD_PX
        }}
      >
        {rows.length > 0 ? (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index]
              if (!row) {
                return null
              }
              return (
                <div
                  key={virtualRow.key}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <UnityConsoleRow
                    row={row}
                    index={virtualRow.index}
                    measureRef={virtualizer.measureElement}
                    expanded={expandedKeys.has(row.key)}
                    onToggleExpanded={() => toggleExpanded(row.key)}
                  />
                </div>
              )
            })}
          </div>
        ) : (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            {session.records.length === 0
              ? translate('auto.components.unity.UnityConsoleSection.empty', 'No console messages.')
              : translate(
                  'auto.components.unity.UnityConsoleSection.noMatches',
                  'No messages match the current filters.'
                )}
          </div>
        )}
      </div>
    </div>
  )
}
