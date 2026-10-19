// Records main-thread stalls and renderer unresponsiveness as trace spans so a
// user-reported UI hang arrives with timing evidence in the diagnostic bundle.
// Passive by design: one unref'd timer, Electron window events, no wrapping.

import { win32 as pathWin32 } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { SpawnBlock } from '../../shared/child-process/spawn-block-observer'
import { classifySubprocessCommand } from '../diagnostics/main-thread-churn-probe'
import { subscribeSystemPowerLifecycle } from '../system-power-lifecycle'
import { startSpan } from './tracer'

const TICK_MS = 100
export const MAIN_THREAD_STALL_THRESHOLD_MS = 200
// Why: a pathological stall storm must not turn the trace file into the problem.
const MAX_STALL_SPANS_PER_MINUTE = 30

let stallTimer: ReturnType<typeof setInterval> | null = null
let unsubscribePowerLifecycle: (() => void) | null = null
let spansThisMinute = 0
let minuteStartedAt = 0
// Why: a timer cannot see what blocked it, but a slow spawn reports itself just before the
// stalled tick fires, so the stall span can name its cause instead of leaving it to correlation.
let lastSlowSpawn: { command: string; blockMs: number; endedAtEpochMs: number } | null = null
// Why: OS sleep stops this timer too, so a multi-hour "stall" is usually a closed lid.
let systemSuspendedAtEpochMs: number | null = null
let systemSuspended = false

function takeSpanBudget(now: number): boolean {
  if (now - minuteStartedAt >= 60_000) {
    minuteStartedAt = now
    spansThisMinute = 0
  }
  spansThisMinute += 1
  return spansThisMinute <= MAX_STALL_SPANS_PER_MINUTE
}

/** A timer due every TICK_MS fires late by exactly the time the thread was blocked. */
export function measureTimerStallMs(previousTickAt: number, now: number): number {
  return Math.max(0, now - previousTickAt - TICK_MS)
}

/** Spawn-block observer: records any spawn that held the main thread past the stall threshold. */
export function recordSlowSpawn(block: SpawnBlock): void {
  if (block.blockMs < MAIN_THREAD_STALL_THRESHOLD_MS) {
    return
  }
  const command = classifySubprocessCommand(block.command, block.args)
  lastSlowSpawn = { command, blockMs: block.blockMs, endedAtEpochMs: Date.now() }
  startSpan('main.slow_spawn', {
    attributes: {
      command,
      // Why: a bare name means uv_spawn walked PATH on this thread; absolute skips that walk.
      binaryIsAbsolute: pathWin32.isAbsolute(block.command) || block.command.startsWith('/'),
      sync: block.sync,
      timedOut: block.timedOut,
      blockMs: Math.round(block.blockMs)
    }
  }).end()
}

function stallAttribution(stallStartedAtEpochMs: number, stallMs: number): Record<string, unknown> {
  const attributes: Record<string, unknown> = {}
  if (
    lastSlowSpawn &&
    lastSlowSpawn.endedAtEpochMs >= stallStartedAtEpochMs &&
    lastSlowSpawn.blockMs >= stallMs / 2
  ) {
    attributes.slowSpawn = lastSlowSpawn.command
    attributes.slowSpawnBlockMs = Math.round(lastSlowSpawn.blockMs)
  }
  if (
    systemSuspended ||
    (systemSuspendedAtEpochMs !== null && systemSuspendedAtEpochMs >= stallStartedAtEpochMs)
  ) {
    attributes.systemSuspended = true
  }
  return attributes
}

export function startMainThreadStallMonitor(): void {
  if (stallTimer) {
    return
  }
  unsubscribePowerLifecycle = subscribeSystemPowerLifecycle({
    onSuspend: () => {
      systemSuspended = true
      systemSuspendedAtEpochMs = Date.now()
    },
    onResume: () => {
      systemSuspended = false
    }
  })
  let lastTickAt = performance.now()
  stallTimer = setInterval(() => {
    const now = performance.now()
    const stallMs = measureTimerStallMs(lastTickAt, now)
    lastTickAt = now
    if (stallMs < MAIN_THREAD_STALL_THRESHOLD_MS || !takeSpanBudget(now)) {
      return
    }
    const stallStartedAtEpochMs = Math.round(Date.now() - stallMs)
    startSpan('main.event_loop_stall', {
      attributes: {
        stallMs: Math.round(stallMs),
        stallStartedAtEpochMs,
        ...stallAttribution(stallStartedAtEpochMs, stallMs)
      }
    }).end()
  }, TICK_MS)
  stallTimer.unref?.()
}

export function stopMainThreadStallMonitor(): void {
  if (stallTimer) {
    clearInterval(stallTimer)
    stallTimer = null
  }
  unsubscribePowerLifecycle?.()
  unsubscribePowerLifecycle = null
  lastSlowSpawn = null
  systemSuspendedAtEpochMs = null
  systemSuspended = false
}

/** Records how long Chromium's hang monitor considered the window unresponsive. */
export function watchWindowResponsiveness(window: BrowserWindow, surface: string): void {
  let unresponsiveSince: number | null = null
  window.on('unresponsive', () => {
    unresponsiveSince = Date.now()
  })
  window.on('responsive', () => {
    if (unresponsiveSince === null) {
      return
    }
    const unresponsiveMs = Date.now() - unresponsiveSince
    unresponsiveSince = null
    startSpan('renderer.unresponsive', {
      attributes: { surface, unresponsiveMs, unresponsiveSinceEpochMs: Date.now() - unresponsiveMs }
    }).end()
  })
}

/** Records a span only when a measured operation crossed the stall threshold. */
export function recordSlowMainOperation(
  name: string,
  startedAt: number,
  attributes: Record<string, unknown> = {}
): void {
  const durationMs = performance.now() - startedAt
  if (durationMs < MAIN_THREAD_STALL_THRESHOLD_MS) {
    return
  }
  startSpan(`main.slow_operation.${name}`, {
    attributes: { ...attributes, durationMs: Math.round(durationMs) }
  }).end()
}
