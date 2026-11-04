import { homedir } from 'node:os'
import { runProcess } from '@orca/process-host'
import { resolveCliCommand } from '../../shared/node-cli-command-resolution'
import { hydrateShellPathForAgentDetection } from '../ipc/agent-detection-shell-path'
import { z } from 'zod'
import { salvagingArray } from '../../shared/zod-salvage'
import type { OmpStatsResult, OmpStatsSnapshot } from '../../shared/pane-usage-types'

// `omp stats` syncs session files before printing; large histories take seconds.
const OMP_STATS_TIMEOUT_MS = 60_000
const OMP_STATS_CACHE_MS = 5 * 60_000
// A missing or broken omp must not respawn on every popover open.
const OMP_STATS_FAILURE_CACHE_MS = 60_000
const OMP_STATS_MAX_OUTPUT_BYTES = 32 * 1024 * 1024
const TOP_MODELS = 8
const TOP_FOLDERS = 6

let cached: { result: OmpStatsResult; at: number } | null = null
let inFlight: Promise<OmpStatsResult> | null = null

const count = z.number().nonnegative().catch(0)
const optionalCount = z.number().nonnegative().nullable().catch(null)
const label = z
  .string()
  .catch('')
  .transform((value) => value.slice(0, 300))

const OmpStatsTotalsOutput = z.object({
  totalRequests: count,
  failedRequests: count,
  totalInputTokens: count,
  totalOutputTokens: count,
  totalCacheReadTokens: count,
  totalCacheWriteTokens: count,
  cacheRate: count.transform((value) => Math.min(1, value)),
  totalCost: count,
  avgDuration: optionalCount,
  avgTtft: optionalCount,
  avgTokensPerSecond: optionalCount
})

function byCostDescending<T extends { totalCost: number }>(limit: number) {
  return (entries: T[]): T[] => entries.sort((a, b) => b.totalCost - a.totalCost).slice(0, limit)
}

const OmpStatsOutput = z.object({
  overall: OmpStatsTotalsOutput,
  byModel: salvagingArray(OmpStatsTotalsOutput.extend({ model: label, provider: label }))
    .catch([])
    .transform(byCostDescending(TOP_MODELS)),
  byFolder: salvagingArray(OmpStatsTotalsOutput.extend({ folder: label }))
    .catch([])
    .transform(byCostDescending(TOP_FOLDERS)),
  byAgentType: salvagingArray(
    z.object({ agentType: label, totalRequests: count, totalCost: count })
  ).catch([]),
  timeSeries: salvagingArray(
    z.object({ timestamp: count, requests: count, tokens: count, cost: count })
  ).catch([])
})

/** Trim `omp stats --json` to what the usage popover draws; null when it is not stats output. */
export function trimOmpStats(raw: unknown, fetchedAt: number): OmpStatsSnapshot | null {
  const parsed = OmpStatsOutput.safeParse(raw)
  return parsed.success ? { fetchedAt, ...parsed.data } : null
}

function parseStatsStdout(stdout: string): unknown {
  try {
    return JSON.parse(stdout)
  } catch {
    // Tolerate a stray log line around the JSON document.
    const start = stdout.indexOf('{')
    const end = stdout.lastIndexOf('}')
    return start !== -1 && end > start ? JSON.parse(stdout.slice(start, end + 1)) : null
  }
}

async function runOmpStats(): Promise<OmpStatsResult> {
  try {
    // Dock launches lack the login-shell PATH where omp is usually installed.
    await hydrateShellPathForAgentDetection()
    const result = await runProcess({
      program: resolveCliCommand('omp'),
      args: ['stats', '--json'],
      cwd: homedir(),
      env: { ...process.env, NO_COLOR: '1' },
      timeoutMs: OMP_STATS_TIMEOUT_MS,
      maxOutputBytes: OMP_STATS_MAX_OUTPUT_BYTES
    })
    if (result.timedOut) {
      return { ok: false, error: 'omp stats timed out' }
    }
    if (result.code !== 0) {
      return { ok: false, error: result.stderr.trim().slice(0, 300) || `omp exited ${result.code}` }
    }
    const stats = trimOmpStats(parseStatsStdout(result.stdout), Date.now())
    return stats ? { ok: true, stats } : { ok: false, error: 'omp stats returned no data' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** omp's /stats dashboard data, shared across callers and cached briefly. */
export function readOmpStats(): Promise<OmpStatsResult> {
  const now = Date.now()
  if (cached) {
    const maxAge = cached.result.ok ? OMP_STATS_CACHE_MS : OMP_STATS_FAILURE_CACHE_MS
    if (now - cached.at < maxAge) {
      return Promise.resolve(cached.result)
    }
  }
  inFlight ??= runOmpStats().then((result) => {
    cached = { result, at: Date.now() }
    inFlight = null
    return result
  })
  return inFlight
}
