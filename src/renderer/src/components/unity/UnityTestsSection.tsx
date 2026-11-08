import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Play, RefreshCw, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { measureVirtualRowRetainingHiddenSize } from '@/hooks/virtualized-hidden-row-measurement'
import { translate } from '@/i18n/i18n'
import type { UnityTestMode } from '../../../../shared/unity-types'
import {
  aggregateUnityTestStatus,
  buildUnityTestTree,
  flattenUnityTestTree
} from './unity-test-tree'
import { loadUnityTests, runUnityTests, useUnityTestSession } from './unity-test-session'
import { formatUnityTestDuration, UnityTestRow } from './UnityTestRow'

const RUNNING_FEEDBACK_DELAY_MS = 200
const ROW_HEIGHT = 24
const UNITY_TEST_MODES: readonly UnityTestMode[] = ['EditMode', 'PlayMode']
const modeByProject = new Map<string, UnityTestMode>()

export function UnityTestsSection({ projectRoot }: { projectRoot: string }): React.JSX.Element {
  const [mode, setMode] = useState<UnityTestMode>(
    () => modeByProject.get(projectRoot) ?? 'EditMode'
  )
  const session = useUnityTestSession(projectRoot, mode)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [openLeafIds, setOpenLeafIds] = useState<ReadonlySet<string>>(() => new Set())
  const [showRunningFeedback, setShowRunningFeedback] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (session.testNames === null && !session.listError) {
      void loadUnityTests(projectRoot, mode)
    }
  }, [projectRoot, mode, session.testNames, session.listError])

  useEffect(() => {
    if (!session.running) {
      setShowRunningFeedback(false)
      return
    }
    const timer = window.setTimeout(() => setShowRunningFeedback(true), RUNNING_FEEDBACK_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [session.running])

  const tree = useMemo(
    () => buildUnityTestTree([...(session.testNames ?? []), ...session.results.keys()]),
    [session.testNames, session.results]
  )
  const rows = useMemo(() => flattenUnityTestTree(tree, collapsedIds), [tree, collapsedIds])
  const failedNames = useMemo(
    () =>
      [...session.results.values()]
        .filter((result) => result.result === 'failed')
        .map((result) => result.fullName),
    [session.results]
  )

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    measureElement: measureVirtualRowRetainingHiddenSize,
    overscan: 16,
    getItemKey: (index) => rows[index]?.node.id ?? `missing:${index}`
  })

  const toggleIn =
    (setter: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>) =>
    (id: string): void =>
      setter((current) => {
        const next = new Set(current)
        if (!next.delete(id)) {
          next.add(id)
        }
        return next
      })
  const toggleCollapsed = toggleIn(setCollapsedIds)
  const toggleLeafOpen = toggleIn(setOpenLeafIds)

  const setNamesSelected = (names: readonly string[], value: boolean): void =>
    setSelected((current) => {
      const next = new Set(current)
      for (const name of names) {
        if (value) {
          next.add(name)
        } else {
          next.delete(name)
        }
      }
      return next
    })

  const selectedNames = [...selected]
  const lastRun = session.lastRun
  const runAllLabel = translate('auto.components.unity.UnityTestsSection.runAll', 'Run all')
  const refreshLabel = translate(
    'auto.components.unity.UnityTestsSection.refreshTests',
    'Refresh test list'
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-sidebar-border px-2 py-1.5">
        <div className="min-w-0 flex-1 rounded-md bg-muted p-0.5">
          <ToggleGroup
            variant="segmented"
            size="xs"
            type="single"
            spacing={1}
            value={mode}
            onValueChange={(value) => {
              if (value === 'EditMode' || value === 'PlayMode') {
                modeByProject.set(projectRoot, value)
                setMode(value)
                setSelected(new Set())
              }
            }}
            aria-label={translate('auto.components.unity.UnityTestsSection.testMode', 'Test mode')}
            className="h-6 w-full"
          >
            {UNITY_TEST_MODES.map((option) => (
              <ToggleGroupItem key={option} value={option} className="min-w-0 flex-1">
                {option}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={refreshLabel}
              disabled={session.listing}
              onClick={() => void loadUnityTests(projectRoot, mode)}
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {refreshLabel}
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-sidebar-border px-2 py-1.5">
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={session.running}
          onClick={() => void runUnityTests(projectRoot, mode, null)}
        >
          <Play />
          {runAllLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={session.running || selectedNames.length === 0}
          onClick={() => void runUnityTests(projectRoot, mode, selectedNames)}
        >
          {translate('auto.components.unity.UnityTestsSection.runSelected', 'Run selected')}
          {selectedNames.length > 0 ? (
            <span className="tabular-nums text-muted-foreground">{selectedNames.length}</span>
          ) : null}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={session.running || failedNames.length === 0}
          onClick={() => void runUnityTests(projectRoot, mode, failedNames)}
        >
          <RotateCcw />
          {translate('auto.components.unity.UnityTestsSection.rerunFailed', 'Rerun failed')}
        </Button>
      </div>
      <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-sidebar-border px-3 text-2xs text-muted-foreground tabular-nums">
        {session.running && showRunningFeedback ? (
          <>
            <LoadingSpinner className="size-3" />
            <span>{translate('auto.components.unity.UnityTestsSection.running', 'Running…')}</span>
          </>
        ) : lastRun ? (
          <span className="truncate">
            {translate(
              'auto.components.unity.UnityTestsSection.summary',
              '{{passed}} passed · {{failed}} failed · {{skipped}} skipped · {{duration}}',
              {
                passed: lastRun.passed,
                failed: lastRun.failed,
                skipped: lastRun.skipped,
                duration: formatUnityTestDuration(lastRun.durationMs)
              }
            )}
          </span>
        ) : (
          <span>
            {translate('auto.components.unity.UnityTestsSection.notRunYet', 'No results yet')}
          </span>
        )}
      </div>
      {session.runError || session.listError ? (
        <div role="alert" className="shrink-0 px-3 py-1.5 text-xs text-destructive break-words">
          {session.runError ?? session.listError}
        </div>
      ) : null}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-sleek py-1"
      >
        {rows.length > 0 ? (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index]
              if (!row) {
                return null
              }
              const { node } = row
              const selectedCount = node.testNames.filter((name) => selected.has(name)).length
              return (
                <div
                  key={virtualRow.key}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <UnityTestRow
                    node={node}
                    depth={row.depth}
                    index={virtualRow.index}
                    measureRef={virtualizer.measureElement}
                    status={aggregateUnityTestStatus(node.testNames, session.results)}
                    result={
                      node.kind === 'test' ? session.results.get(node.testNames[0]) : undefined
                    }
                    checked={
                      selectedCount === 0
                        ? false
                        : selectedCount === node.testNames.length
                          ? true
                          : 'indeterminate'
                    }
                    open={
                      node.kind === 'test' ? openLeafIds.has(node.id) : !collapsedIds.has(node.id)
                    }
                    onToggleOpen={() =>
                      node.kind === 'test' ? toggleLeafOpen(node.id) : toggleCollapsed(node.id)
                    }
                    onCheckedChange={(value) => setNamesSelected(node.testNames, value)}
                  />
                </div>
              )
            })}
          </div>
        ) : session.listing || session.testNames === null ? (
          session.listError && !session.listing ? null : (
            <div className="flex items-center justify-center gap-1.5 px-3 py-6 text-xs text-muted-foreground">
              {translate('auto.components.unity.UnityTestsSection.loading', 'Loading tests…')}
            </div>
          )
        ) : (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            {translate(
              'auto.components.unity.UnityTestsSection.empty',
              'No {{mode}} tests in this project.',
              { mode }
            )}
          </div>
        )}
      </div>
    </div>
  )
}
