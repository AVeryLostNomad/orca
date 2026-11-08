import type React from 'react'
import { ChevronRight, Circle, CircleAlert, CircleCheck, CircleSlash, CircleX } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { basename } from '@/lib/path'
import { translate } from '@/i18n/i18n'
import type { UnityTestCaseResult } from '../../../../shared/unity-types'
import type { UnityTestStatus, UnityTestTreeNode } from './unity-test-tree'
import { openUnityFileLocation } from './unity-open-location'

const STATUS_ICON: Record<UnityTestStatus, React.ComponentType<{ className?: string }>> = {
  passed: CircleCheck,
  failed: CircleX,
  skipped: CircleSlash,
  inconclusive: CircleAlert,
  'not-run': Circle
}

const STATUS_ICON_CLASS: Record<UnityTestStatus, string> = {
  passed: 'text-status-success',
  failed: 'text-destructive',
  skipped: 'text-muted-foreground',
  inconclusive: 'text-status-warning',
  'not-run': 'text-muted-foreground/50'
}

const STATUS_LABEL: Record<UnityTestStatus, () => string> = {
  passed: () => translate('auto.components.unity.UnityTestRow.passed', 'Passed'),
  failed: () => translate('auto.components.unity.UnityTestRow.failed', 'Failed'),
  skipped: () => translate('auto.components.unity.UnityTestRow.skipped', 'Skipped'),
  inconclusive: () => translate('auto.components.unity.UnityTestRow.inconclusive', 'Inconclusive'),
  'not-run': () => translate('auto.components.unity.UnityTestRow.notRun', 'Not run')
}

export function formatUnityTestDuration(durationMs: number): string {
  return durationMs < 1000 ? `${Math.round(durationMs)} ms` : `${(durationMs / 1000).toFixed(2)} s`
}

export function UnityTestRow({
  node,
  depth,
  status,
  result,
  checked,
  open,
  onToggleOpen,
  onCheckedChange,
  measureRef,
  index
}: {
  node: UnityTestTreeNode
  depth: number
  status: UnityTestStatus
  /** Leaf result, when this test has run. */
  result: UnityTestCaseResult | undefined
  checked: boolean | 'indeterminate'
  /** Groups: children shown. Leaves: failure details shown. */
  open: boolean
  onToggleOpen: () => void
  onCheckedChange: (checked: boolean) => void
  measureRef: (element: HTMLElement | null) => void
  index: number
}): React.JSX.Element {
  const StatusIcon = STATUS_ICON[status]
  const isLeaf = node.kind === 'test'
  const hasDetails = isLeaf && Boolean(result?.message || result?.stackTrace)
  const canToggle = !isLeaf || hasDetails
  const file = result?.file
  const location = file ? `${basename(file)}${result?.line ? `:${result.line}` : ''}` : null

  return (
    <div ref={measureRef} data-index={index}>
      <div
        className="flex h-6 items-center gap-1 pr-2 hover:bg-accent"
        style={{ paddingLeft: 6 + depth * 12 }}
      >
        {canToggle ? (
          <button
            type="button"
            className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={onToggleOpen}
            aria-expanded={open}
            aria-label={
              open
                ? translate('auto.components.unity.UnityTestRow.collapse', 'Collapse')
                : translate('auto.components.unity.UnityTestRow.expand', 'Expand')
            }
          >
            <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
          </button>
        ) : (
          <span className="size-4 shrink-0" />
        )}
        <Checkbox
          checked={checked}
          onCheckedChange={(value) => onCheckedChange(value === true)}
          aria-label={translate('auto.components.unity.UnityTestRow.select', 'Select {{name}}', {
            name: node.label
          })}
          className="size-3.5"
        />
        <StatusIcon
          className={cn('size-3.5 shrink-0', STATUS_ICON_CLASS[status])}
          aria-label={STATUS_LABEL[status]()}
        />
        <button
          type="button"
          className={cn(
            'min-w-0 flex-1 truncate rounded-sm text-left text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            isLeaf ? 'text-foreground' : 'font-medium text-foreground'
          )}
          onClick={() => (file ? openUnityFileLocation(file, result?.line) : onToggleOpen())}
        >
          {node.label}
        </button>
        {result ? (
          <span className="shrink-0 text-3xs text-muted-foreground tabular-nums">
            {formatUnityTestDuration(result.durationMs)}
          </span>
        ) : null}
      </div>
      {isLeaf && open && hasDetails ? (
        <div className="space-y-1.5 pr-2 pb-2" style={{ paddingLeft: 26 + depth * 12 }}>
          {result?.message ? (
            <pre className="font-mono text-2xs whitespace-pre-wrap break-words text-foreground">
              {result.message}
            </pre>
          ) : null}
          {result?.stackTrace ? (
            <pre className="font-mono text-2xs whitespace-pre-wrap break-words text-muted-foreground">
              {result.stackTrace}
            </pre>
          ) : null}
          {file && location ? (
            <button
              type="button"
              className="font-mono text-2xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => openUnityFileLocation(file, result?.line)}
            >
              {location}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
