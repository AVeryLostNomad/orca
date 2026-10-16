// Records main-thread stalls and renderer unresponsiveness as trace spans so a
// user-reported UI hang arrives with timing evidence in the diagnostic bundle.
// Passive by design: one unref'd timer, Electron window events, no wrapping.

import type { BrowserWindow } from 'electron'
import { startSpan } from './tracer'

const TICK_MS = 100
export const MAIN_THREAD_STALL_THRESHOLD_MS = 200
// Why: a pathological stall storm must not turn the trace file into the problem.
const MAX_STALL_SPANS_PER_MINUTE = 30

let stallTimer: ReturnType<typeof setInterval> | null = null
let spansThisMinute = 0
let minuteStartedAt = 0

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

export function startMainThreadStallMonitor(): void {
  if (stallTimer) {
    return
  }
  let lastTickAt = performance.now()
  stallTimer = setInterval(() => {
    const now = performance.now()
    const stallMs = measureTimerStallMs(lastTickAt, now)
    lastTickAt = now
    if (stallMs < MAIN_THREAD_STALL_THRESHOLD_MS || !takeSpanBudget(now)) {
      return
    }
    startSpan('main.event_loop_stall', {
      attributes: {
        stallMs: Math.round(stallMs),
        stallStartedAtEpochMs: Math.round(Date.now() - stallMs)
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
