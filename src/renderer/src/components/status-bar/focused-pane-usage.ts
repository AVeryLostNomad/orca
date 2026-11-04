import type {
  PaneUsageAccount,
  PaneUsageLimit,
  PaneUsageSnapshot
} from '../../../../shared/pane-usage-types'
import type {
  ProviderRateLimits,
  RateLimitBucket,
  RateLimitState,
  RateLimitWindow
} from '../../../../shared/rate-limit-types'

export type FocusedPaneUsage = {
  snapshot: PaneUsageSnapshot
  /** Bars for accounts Orca has a provider chip for; empty falls back to host bars. */
  providers: ProviderRateLimits[]
  /** Accounts without a bar (unknown provider or a second account per provider), shown in the popover. */
  otherAccounts: PaneUsageAccount[]
}

const PROVIDER_BY_OMP_PROVIDER: Record<string, ProviderRateLimits['provider']> = {
  anthropic: 'claude',
  'openai-codex': 'codex',
  cursor: 'cursor',
  'google-antigravity': 'antigravity'
}

const SESSION_MINUTES = 300
const WEEKLY_MINUTES = 10_080
const MONTHLY_MINUTES = 43_200

function isNearWindow(limit: PaneUsageLimit, minutes: number): boolean {
  // Why: providers report rolling windows with small drift (e.g. 5h ± a few minutes).
  return limit.windowMinutes !== null && Math.abs(limit.windowMinutes - minutes) <= minutes * 0.1
}

function toWindow(limit: PaneUsageLimit, windowMinutes: number): RateLimitWindow {
  return {
    usedPercent: Math.min(100, Math.max(0, limit.usedPercent)),
    windowMinutes,
    resetsAt: limit.resetsAt,
    resetDescription: null
  }
}

export function paneUsageAccountToProviderRateLimits(
  account: PaneUsageAccount,
  provider: ProviderRateLimits['provider'],
  updatedAt: number
): ProviderRateLimits {
  // Why: omp reports Claude's Fable pool as `anthropic:7d:fable`, which the chip shows as its own weekly window.
  const fableIndex = account.limits.findIndex(
    (limit) => limit.id.endsWith(':fable') && isNearWindow(limit, WEEKLY_MINUTES)
  )
  const fableWeekly =
    provider === 'claude' && fableIndex !== -1
      ? toWindow(account.limits[fableIndex], WEEKLY_MINUTES)
      : null
  const remaining = account.limits.filter(
    (_, index) => fableWeekly === null || index !== fableIndex
  )
  const take = (minutes: number): RateLimitWindow | null => {
    const index = remaining.findIndex((limit) => isNearWindow(limit, minutes))
    if (index === -1) {
      return null
    }
    const [limit] = remaining.splice(index, 1)
    return toWindow(limit, minutes)
  }
  const session = take(SESSION_MINUTES)
  const weekly = take(WEEKLY_MINUTES)
  const monthly = take(MONTHLY_MINUTES)
  const buckets: RateLimitBucket[] = remaining.map((limit) => ({
    ...toWindow(limit, limit.windowMinutes ?? 0),
    name: limit.label
  }))
  return {
    provider,
    session,
    weekly,
    monthly,
    ...(fableWeekly ? { fableWeekly } : {}),
    ...(buckets.length > 0 ? { buckets } : {}),
    updatedAt,
    error: null,
    status: 'ok',
    usageMetadata: { source: 'live-session' }
  }
}

/** Usage for the focused pane, only while that pane still runs the agent that reported it. */
export function resolveFocusedPaneUsage(
  rateLimits: Pick<RateLimitState, 'paneUsage'>,
  paneKey: string | null,
  paneAgent: string | null
): FocusedPaneUsage | null {
  if (!paneKey || !paneAgent) {
    return null
  }
  const snapshot = rateLimits.paneUsage?.find((entry) => entry.paneKey === paneKey)
  if (!snapshot || snapshot.agent !== paneAgent) {
    return null
  }
  const providers: ProviderRateLimits[] = []
  const otherAccounts: PaneUsageAccount[] = []
  const seen = new Set<ProviderRateLimits['provider']>()
  const ordered = [...snapshot.accounts].sort((a, b) => Number(b.active) - Number(a.active))
  for (const account of ordered) {
    const provider = PROVIDER_BY_OMP_PROVIDER[account.provider] ?? null
    // Why: chips are keyed by provider, so only the first (active-first) account per provider gets a bar.
    if (!provider || seen.has(provider) || account.limits.length === 0) {
      otherAccounts.push(account)
      continue
    }
    seen.add(provider)
    providers.push(paneUsageAccountToProviderRateLimits(account, provider, snapshot.updatedAt))
  }
  return { snapshot, providers, otherAccounts }
}
