// Usage reported by the agent running in one terminal pane, so the status bar can follow the focused pane.

export const OMP_USAGE_PATHNAME = '/usage/omp'

/** getOmpStats error for hosts that cannot run omp (paired/web clients). */
export const OMP_STATS_UNAVAILABLE = 'unavailable'

export type PaneUsageAgent = 'omp' | 'claude'

export type PaneUsageLimit = {
  /** Provider limit id, e.g. `anthropic:5h` or `openai-codex:primary`. */
  id: string
  label: string
  /** 0–100. */
  usedPercent: number
  windowMinutes: number | null
  /** Unix ms, if known. */
  resetsAt: number | null
}

/** The account a pane's session routes one provider through. */
export type PaneUsageAccount = {
  /** omp provider id (`anthropic`, `openai-codex`, …); Claude Code panes report `anthropic`. */
  provider: string
  /** Email or account id, when known. */
  label: string | null
  /** True for the provider of the session's current model. */
  active: boolean
  limits: PaneUsageLimit[]
}

export type PaneUsageSessionStats = {
  /** `provider/id`. */
  model: string | null
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  premiumRequests: number
  /** USD. */
  cost: number
  contextTokens: number | null
  contextWindow: number | null
}

export type PaneUsageSnapshot = {
  paneKey: string
  agent: PaneUsageAgent
  updatedAt: number
  accounts: PaneUsageAccount[]
  /** omp only. */
  session: PaneUsageSessionStats | null
}

export type OmpStatsTotals = {
  totalRequests: number
  failedRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  cacheRate: number
  totalCost: number
  avgDuration: number | null
  avgTtft: number | null
  avgTokensPerSecond: number | null
}

/** Trimmed `omp stats --json` (omp's /stats dashboard data, last 24h). */
export type OmpStatsSnapshot = {
  fetchedAt: number
  overall: OmpStatsTotals
  byModel: (OmpStatsTotals & { model: string; provider: string })[]
  byFolder: (OmpStatsTotals & { folder: string })[]
  byAgentType: {
    agentType: string
    totalRequests: number
    totalCost: number
  }[]
  timeSeries: { timestamp: number; requests: number; tokens: number; cost: number }[]
}

export type OmpStatsResult = { ok: true; stats: OmpStatsSnapshot } | { ok: false; error: string }
