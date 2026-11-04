import { OMP_USAGE_PATHNAME } from '../../shared/pane-usage-types'
import { getOmpPaneUsageAccountSourceLines } from './omp-pane-usage-account-source'

// Orca's status bar follows the focused pane, so each omp session publishes the accounts it routes through.
export function getOmpPaneUsageSourceLines(): string[] {
  return [
    `const PANE_USAGE_PATH = '${OMP_USAGE_PATHNAME}'`,
    ...getOmpPaneUsageAccountSourceLines(),
    ...String.raw`
const PANE_USAGE_POLL_MS = 60000
// Unchanged usage still re-posts occasionally so a restarted Orca relearns it.
const PANE_USAGE_REFRESH_MS = 300000
const PANE_USAGE_FETCH_TIMEOUT_MS = 30000
const PANE_USAGE_POST_TIMEOUT_MS = 5000

function paneUsageModel(ctx): { provider: string; id: string } | null {
  try {
    const model = ctx?.model
    return model && typeof model.provider === 'string' && typeof model.id === 'string' && model.provider && model.id
      ? { provider: model.provider, id: model.id }
      : null
  } catch {
    return null
  }
}

function paneUsageCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function paneUsageSession(ctx, model: { provider: string; id: string } | null) {
  let stats
  let context
  try {
    stats = ctx?.sessionManager?.getUsageStatistics?.()
  } catch {
    stats = undefined
  }
  if (!stats || typeof stats !== 'object') return null
  try {
    context = ctx?.getContextUsage?.()
  } catch {
    context = undefined
  }
  return {
    model: model ? model.provider + '/' + model.id : null,
    input: paneUsageCount(stats.input),
    output: paneUsageCount(stats.output),
    cacheRead: paneUsageCount(stats.cacheRead),
    cacheWrite: paneUsageCount(stats.cacheWrite),
    premiumRequests: paneUsageCount(stats.premiumRequests),
    cost: paneUsageCount(stats.cost),
    contextTokens: typeof context?.tokens === 'number' && Number.isFinite(context.tokens) && context.tokens >= 0 ? context.tokens : null,
    contextWindow: typeof context?.contextWindow === 'number' && context.contextWindow > 0 ? context.contextWindow : null,
  }
}

// Usage is best-effort: it never throws into omp and never delays a turn.
function createPaneUsagePublisher() {
  let ctx = null
  let generation = 0
  let timer = null
  let timerOwner = null
  let inFlight = false
  let queued = false
  let lastDelivered = ''
  let lastDeliveredAt = 0
  let lastModel = ''

  function stopTimer(): void {
    if (timer === null) return
    try {
      if (typeof timerOwner?.clearTimer === 'function') timerOwner.clearTimer(timer)
      else clearInterval(timer)
    } catch {
      // A torn-down session may already have cleared its timers.
    }
    timer = null
    timerOwner = null
  }

  // ctx.setInterval contains throws and clears itself on session_shutdown.
  function startTimer(owner): void {
    if (timer !== null) return
    const tick = () => { void publish() }
    try {
      if (typeof owner.setInterval === 'function') {
        timer = owner.setInterval(tick, PANE_USAGE_POLL_MS)
        timerOwner = owner
      } else {
        timer = setInterval(tick, PANE_USAGE_POLL_MS)
        if (typeof timer?.unref === 'function') timer.unref()
      }
    } catch {
      timer = null
    }
  }

  // omp 18 moved report fetching onto the usage facet; older builds expose it on AuthStorage.
  function usageReportsFetcher(authStorage) {
    if (typeof authStorage?.usage?.reports === 'function') return (options) => authStorage.usage.reports(options)
    if (typeof authStorage?.fetchUsageReports === 'function') return (options) => authStorage.fetchUsageReports(options)
    return null
  }

  async function fetchReports(fetchUsageReports, registry) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    const expired = Promise.withResolvers()
    const timeout = setTimeout(() => {
      controller?.abort()
      expired.resolve(null)
    }, PANE_USAGE_FETCH_TIMEOUT_MS)
    if (typeof timeout?.unref === 'function') timeout.unref()
    try {
      return await Promise.race([
        fetchUsageReports({
          baseUrlResolver: (provider) => registry?.getProviderBaseUrl?.(provider),
          ...(controller ? { signal: controller.signal } : {}),
        }),
        expired.promise,
      ])
    } finally {
      clearTimeout(timeout)
    }
  }

  async function deliver(port: string, token: string, body: string): Promise<void> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timeout = setTimeout(() => controller?.abort(), PANE_USAGE_POST_TIMEOUT_MS)
    if (typeof timeout?.unref === 'function') timeout.unref()
    try {
      const response = await fetch('http://127.0.0.1:' + port + PANE_USAGE_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Orca-Agent-Hook-Token': token },
        body,
        ...(controller ? { signal: controller.signal } : {}),
      })
      if (!response.ok) throw new Error('Orca usage HTTP ' + response.status)
    } catch (error) {
      if (!isWslRuntime()) throw error
      await postViaWindowsCurl(body, true, PANE_USAGE_PATH)
    } finally {
      clearTimeout(timeout)
    }
  }

  async function publish(): Promise<void> {
    if (inFlight) {
      queued = true
      return
    }
    const current = ctx
    const currentGeneration = generation
    const paneKey = process.env.ORCA_PANE_KEY
    const registry = current?.modelRegistry
    const authStorage = registry?.authStorage
    const fetchUsageReports = usageReportsFetcher(authStorage)
    if (!paneKey || !fetchUsageReports) return
    inFlight = true
    try {
      startTimer(current)
      const reports = await fetchReports(fetchUsageReports, registry)
      if (currentGeneration !== generation) return
      const model = paneUsageModel(current)
      let sessionId
      try {
        sessionId = current.sessionManager?.getSessionId?.()
      } catch {
        sessionId = undefined
      }
      const accounts = paneUsageAccounts(reports, authStorage, sessionId, model?.provider ?? '')
      const session = paneUsageSession(current, model)
      if (accounts.length === 0 && !session) return
      const coords = resolveHookCoords()
      if (!coords.port || !coords.token) return
      const body = JSON.stringify({ paneKey, agent: 'omp', accounts, session })
      // A new endpoint means a restarted Orca that has not seen this usage yet.
      const deliveryKey = coords.port + '\n' + coords.token + '\n' + body
      const now = Date.now()
      if (deliveryKey === lastDelivered && now - lastDeliveredAt < PANE_USAGE_REFRESH_MS) return
      await deliver(coords.port, coords.token, body)
      lastDelivered = deliveryKey
      lastDeliveredAt = now
    } catch {
      // Silent: the next event or poll retries.
    } finally {
      inFlight = false
      if (queued) {
        queued = false
        void publish()
      }
    }
  }

  return {
    // New sessions and model switches publish at once; other events only refresh the context.
    track(nextCtx, sessionChanged: boolean): void {
      if (!nextCtx) return
      if (sessionChanged) {
        generation += 1
        lastDelivered = ''
      }
      ctx = nextCtx
      const model = paneUsageModel(nextCtx)
      const modelKey = model ? model.provider + '/' + model.id : ''
      if (!sessionChanged && modelKey === lastModel) return
      lastModel = modelKey
      void publish()
    },
    refresh(nextCtx): void {
      if (nextCtx) ctx = nextCtx
      void publish()
    },
    stop(): void {
      stopTimer()
      generation += 1
      ctx = null
      lastModel = ''
    },
  }
}
`.split('\n')
  ]
}

export function getOmpPaneUsageHandlerSourceLines(): string[] {
  return [
    '  const paneUsage = createPaneUsagePublisher()',
    "  onStatus('session_start', (_event, ctx) => paneUsage.track(ctx, true))",
    "  onStatus('session_switch', (_event, ctx) => paneUsage.track(ctx, true))",
    "  onStatus('before_agent_start', (_event, ctx) => paneUsage.track(ctx, false))",
    // model_select may fire before ctx.model updates; publish reads it after the usage fetch.
    "  onStatus('model_select', (_event, ctx) => paneUsage.refresh(ctx))",
    "  onStatus('agent_end', (event, ctx) => { if (event?.willContinue !== true) paneUsage.refresh(ctx) })",
    "  onStatus('session_shutdown', () => paneUsage.stop())",
    ''
  ]
}
