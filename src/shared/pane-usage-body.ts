import { z } from 'zod'
import { salvagingArray } from './zod-salvage'
import type { PaneUsageSnapshot } from './pane-usage-types'

// Agent-supplied bodies are untrusted; bound everything the renderer will hold and draw.
export const PANE_USAGE_MAX_ACCOUNTS = 12
export const PANE_USAGE_MAX_LIMITS = 16
const MAX_PANE_KEY_LENGTH = 256
const MAX_ID_LENGTH = 128
const MAX_LABEL_LENGTH = 200

function boundedText(maxLength: number) {
  return z
    .string()
    .trim()
    .min(1)
    .transform((value) => value.slice(0, maxLength))
}

function boundedList<T extends z.ZodType>(item: T, max: number) {
  return salvagingArray(item)
    .catch([])
    .transform((entries) => entries.slice(0, max))
}

const count = z.number().nonnegative().catch(0)
const positiveOrNull = z.number().positive().nullable().catch(null)

const PaneUsageLimitBody = z
  .object({
    id: boundedText(MAX_ID_LENGTH),
    label: boundedText(MAX_LABEL_LENGTH).optional().catch(undefined),
    usedPercent: z.number().transform((value) => Math.min(100, Math.max(0, value))),
    windowMinutes: positiveOrNull,
    resetsAt: positiveOrNull
  })
  .transform((limit) => ({ ...limit, label: limit.label ?? limit.id }))

const PaneUsageAccountBody = z.object({
  provider: boundedText(MAX_ID_LENGTH),
  label: boundedText(MAX_LABEL_LENGTH).nullable().catch(null),
  active: z.boolean().catch(false),
  limits: boundedList(PaneUsageLimitBody, PANE_USAGE_MAX_LIMITS)
})

const PaneUsageSessionBody = z.object({
  model: boundedText(MAX_LABEL_LENGTH).nullable().catch(null),
  input: count,
  output: count,
  cacheRead: count,
  cacheWrite: count,
  premiumRequests: count,
  cost: count,
  contextTokens: z.number().nonnegative().nullable().catch(null),
  contextWindow: positiveOrNull
})

const OmpPaneUsageBody = z.object({
  paneKey: boundedText(MAX_PANE_KEY_LENGTH),
  accounts: boundedList(PaneUsageAccountBody, PANE_USAGE_MAX_ACCOUNTS),
  session: PaneUsageSessionBody.nullable().catch(null)
})

/** Parse an omp extension `/usage/omp` body; null when it names no pane. */
export function parsePaneUsageBody(body: unknown, now = Date.now()): PaneUsageSnapshot | null {
  const parsed = OmpPaneUsageBody.safeParse(body)
  return parsed.success ? { ...parsed.data, agent: 'omp', updatedAt: now } : null
}
