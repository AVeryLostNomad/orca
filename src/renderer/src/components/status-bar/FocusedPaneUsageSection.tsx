import React, { useEffect, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { useResetCountdownClock } from '@/hooks/useResetCountdownClock'
import { formatResetCountdown } from '../../../../shared/rate-limit-reset-format'
import type {
  OmpStatsResult,
  OmpStatsSnapshot,
  PaneUsageAccount,
  PaneUsageSessionStats
} from '../../../../shared/pane-usage-types'
import { OMP_STATS_UNAVAILABLE } from '../../../../shared/pane-usage-types'
import type { FocusedPaneUsage } from './focused-pane-usage'
import { barColor } from './provider-extra-usage-section'
import { formatCompactCount } from './workspace-space-format'

function formatCost(usd: number): string {
  return usd >= 100 ? `$${usd.toFixed(0)}` : `$${usd.toFixed(2)}`
}

/** "Focused pane · OMP · user@example.com" line shown above the pane's bars. */
export function FocusedPaneScopeHeader({ usage }: { usage: FocusedPaneUsage }): React.JSX.Element {
  const active =
    usage.snapshot.accounts.find((account) => account.active) ?? usage.snapshot.accounts[0]
  const parts = [
    translate('auto.components.status.bar.FocusedPaneUsageSection.focusedPane', 'Focused pane'),
    usage.snapshot.agent === 'omp' ? 'OMP' : 'Claude Code',
    active?.label ?? null
  ].filter((part): part is string => Boolean(part))
  return (
    <div className="truncate px-3.5 pb-2 text-[11px] text-muted-foreground">
      {parts.join(' · ')}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="truncate text-muted-foreground">{label}</span>
      <span className="shrink-0 tabular-nums text-foreground">{value}</span>
    </div>
  )
}

function OtherAccounts({ accounts }: { accounts: PaneUsageAccount[] }): React.JSX.Element | null {
  const withLimits = accounts.filter((account) => account.limits.length > 0)
  const now = useResetCountdownClock(
    withLimits.flatMap((account) => account.limits.map((limit) => limit.resetsAt))
  )
  if (withLimits.length === 0) {
    return null
  }
  return (
    <>
      <SectionTitle>
        {translate(
          'auto.components.status.bar.FocusedPaneUsageSection.otherAccounts',
          'Other accounts'
        )}
      </SectionTitle>
      {withLimits.map((account) => (
        <div key={`${account.provider}:${account.label ?? ''}`} className="py-1">
          <div className="truncate text-foreground">
            {account.provider}
            {account.label ? (
              <span className="text-muted-foreground"> · {account.label}</span>
            ) : null}
          </div>
          {account.limits.map((limit) => (
            <div key={limit.id} className="flex items-center gap-2 py-0.5">
              <span className="w-24 shrink-0 truncate text-muted-foreground">{limit.label}</span>
              <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full ${barColor(limit.usedPercent)}`}
                  style={{ width: `${Math.min(100, Math.max(0, limit.usedPercent))}%` }}
                />
              </div>
              <span className="w-9 shrink-0 text-right tabular-nums">
                {Math.round(limit.usedPercent)}%
              </span>
              <span className="w-14 shrink-0 text-right text-muted-foreground">
                {limit.resetsAt ? formatResetCountdown(limit.resetsAt - now) : ''}
              </span>
            </div>
          ))}
        </div>
      ))}
    </>
  )
}

function SessionStats({ session }: { session: PaneUsageSessionStats }): React.JSX.Element {
  const context =
    session.contextTokens !== null && session.contextWindow
      ? `${formatCompactCount(session.contextTokens)} / ${formatCompactCount(session.contextWindow)}`
      : null
  return (
    <>
      <SectionTitle>
        {translate('auto.components.status.bar.FocusedPaneUsageSection.session', 'This session')}
      </SectionTitle>
      {session.model ? (
        <StatRow
          label={translate('auto.components.status.bar.FocusedPaneUsageSection.model', 'Model')}
          value={session.model}
        />
      ) : null}
      <StatRow
        label={translate(
          'auto.components.status.bar.FocusedPaneUsageSection.tokens',
          'Tokens in / out'
        )}
        value={`${formatCompactCount(session.input)} / ${formatCompactCount(session.output)}`}
      />
      <StatRow
        label={translate(
          'auto.components.status.bar.FocusedPaneUsageSection.cache',
          'Cache read / write'
        )}
        value={`${formatCompactCount(session.cacheRead)} / ${formatCompactCount(session.cacheWrite)}`}
      />
      <StatRow
        label={translate('auto.components.status.bar.FocusedPaneUsageSection.cost', 'Cost')}
        value={formatCost(session.cost)}
      />
      {context ? (
        <StatRow
          label={translate('auto.components.status.bar.FocusedPaneUsageSection.context', 'Context')}
          value={context}
        />
      ) : null}
    </>
  )
}

function useOmpStats(): OmpStatsResult | null {
  const [result, setResult] = useState<OmpStatsResult | null>(null)
  useEffect(() => {
    let cancelled = false
    // Why: mounted only while the popover is open on an omp pane, so each open fetches once.
    window.api.paneUsage
      .getOmpStats()
      .then((next) => {
        if (!cancelled) {
          setResult(next)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setResult({ ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])
  return result
}

function ActivityBars({
  series
}: {
  series: OmpStatsSnapshot['timeSeries']
}): React.JSX.Element | null {
  if (series.length === 0) {
    return null
  }
  const max = Math.max(...series.map((point) => point.tokens), 1)
  return (
    <div className="flex h-6 items-end gap-px py-1" aria-hidden>
      {series.map((point) => (
        <div
          key={point.timestamp}
          className="min-w-0 flex-1 rounded-sm bg-muted-foreground/40"
          style={{ height: `${Math.max(8, (point.tokens / max) * 100)}%` }}
        />
      ))}
    </div>
  )
}

function OmpDashboard({ stats }: { stats: OmpStatsSnapshot }): React.JSX.Element {
  const { overall } = stats
  const tokens =
    overall.totalInputTokens +
    overall.totalOutputTokens +
    overall.totalCacheReadTokens +
    overall.totalCacheWriteTokens
  const speed = [
    overall.avgTtft !== null ? `${(overall.avgTtft / 1000).toFixed(1)}s` : null,
    overall.avgTokensPerSecond !== null ? `${Math.round(overall.avgTokensPerSecond)} tok/s` : null
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')
  const topModels = [...stats.byModel].sort((a, b) => b.totalCost - a.totalCost).slice(0, 3)
  const topFolders = [...stats.byFolder].sort((a, b) => b.totalCost - a.totalCost).slice(0, 3)
  return (
    <>
      <StatRow
        label={translate('auto.components.status.bar.FocusedPaneUsageSection.requests', 'Requests')}
        value={
          overall.failedRequests > 0
            ? `${formatCompactCount(overall.totalRequests)} (${overall.failedRequests} failed)`
            : formatCompactCount(overall.totalRequests)
        }
      />
      <StatRow
        label={translate(
          'auto.components.status.bar.FocusedPaneUsageSection.totalTokens',
          'Tokens'
        )}
        value={formatCompactCount(tokens)}
      />
      <StatRow
        label={translate('auto.components.status.bar.FocusedPaneUsageSection.cost', 'Cost')}
        value={formatCost(overall.totalCost)}
      />
      <StatRow
        label={translate(
          'auto.components.status.bar.FocusedPaneUsageSection.cacheRate',
          'Cache rate'
        )}
        value={`${Math.round(overall.cacheRate * 100)}%`}
      />
      {speed ? (
        <StatRow
          label={translate(
            'auto.components.status.bar.FocusedPaneUsageSection.speed',
            'Avg TTFT / speed'
          )}
          value={speed}
        />
      ) : null}
      <ActivityBars series={stats.timeSeries} />
      {topModels.length > 0 ? (
        <>
          <SectionTitle>
            {translate(
              'auto.components.status.bar.FocusedPaneUsageSection.topModels',
              'Top models'
            )}
          </SectionTitle>
          {topModels.map((model) => (
            <StatRow
              key={`${model.provider}/${model.model}`}
              label={model.model}
              value={formatCost(model.totalCost)}
            />
          ))}
        </>
      ) : null}
      {topFolders.length > 0 ? (
        <>
          <SectionTitle>
            {translate(
              'auto.components.status.bar.FocusedPaneUsageSection.topFolders',
              'Top folders'
            )}
          </SectionTitle>
          {topFolders.map((folder) => (
            <StatRow
              key={folder.folder}
              label={folder.folder}
              value={formatCost(folder.totalCost)}
            />
          ))}
        </>
      ) : null}
      {stats.byAgentType.length > 0 ? (
        <>
          <SectionTitle>
            {translate(
              'auto.components.status.bar.FocusedPaneUsageSection.agents',
              'Main vs subagents'
            )}
          </SectionTitle>
          {stats.byAgentType.map((entry) => (
            <StatRow
              key={entry.agentType}
              label={entry.agentType}
              value={`${formatCompactCount(entry.totalRequests)} · ${formatCost(entry.totalCost)}`}
            />
          ))}
        </>
      ) : null}
    </>
  )
}

function OmpStatsBlock(): React.JSX.Element | null {
  const result = useOmpStats()
  // Why: paired/web clients cannot run omp locally; hide rather than show a dead section.
  if (result && !result.ok && result.error === OMP_STATS_UNAVAILABLE) {
    return null
  }
  return (
    <>
      <SectionTitle>
        {translate('auto.components.status.bar.FocusedPaneUsageSection.last24h', 'OMP · last 24h')}
      </SectionTitle>
      {result === null ? (
        <div className="py-1 text-muted-foreground">
          {translate(
            'auto.components.status.bar.FocusedPaneUsageSection.loading',
            'Loading stats…'
          )}
        </div>
      ) : result.ok ? (
        <OmpDashboard stats={result.stats} />
      ) : (
        <div className="py-1 text-muted-foreground">
          {translate(
            'auto.components.status.bar.FocusedPaneUsageSection.statsError',
            'Stats unavailable'
          )}
        </div>
      )}
    </>
  )
}

/** Popover details for the focused pane: unbarred accounts, session stats, and omp's /stats. */
export function FocusedPaneUsageSection({ usage }: { usage: FocusedPaneUsage }): React.JSX.Element {
  const { snapshot } = usage
  return (
    <>
      <div className="border-t border-border/70" />
      <div className="scrollbar-sleek max-h-[280px] overflow-y-auto px-3.5 pb-2.5 text-xs">
        <OtherAccounts accounts={usage.otherAccounts} />
        {snapshot.session ? <SessionStats session={snapshot.session} /> : null}
        {snapshot.agent === 'omp' ? <OmpStatsBlock /> : null}
      </div>
    </>
  )
}
