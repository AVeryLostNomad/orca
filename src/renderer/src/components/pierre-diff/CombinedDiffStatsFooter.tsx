import React from 'react'
import { translate } from '@/i18n/i18n'

/** Diffshub-style totals pinned under the combined-diff file tree. */
export function CombinedDiffStatsFooter({
  fileCount,
  added,
  removed
}: {
  fileCount: number
  added: number
  removed: number
}): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-background px-3 py-1.5 text-[11px] text-muted-foreground">
      <span className="min-w-0 truncate">
        {fileCount}{' '}
        {fileCount === 1
          ? translate(
              'auto.components.pierre.diff.CombinedDiffStatsFooter.ada01f259a',
              'file changed'
            )
          : translate(
              'auto.components.pierre.diff.CombinedDiffStatsFooter.21779f63e1',
              'files changed'
            )}
      </span>
      {/* Why: git decoration tokens keep counts on the documented status palette (see DiffLineCounts). */}
      <span className="shrink-0 tabular-nums">
        <span style={{ color: 'var(--git-decoration-added)' }}>+{added}</span>{' '}
        <span style={{ color: 'var(--git-decoration-deleted)' }}>-{removed}</span>
      </span>
    </div>
  )
}
