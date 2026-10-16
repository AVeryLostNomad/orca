import { recordRendererCrashBreadcrumb } from './crash-breadcrumb-recorder'

// Records renderer frames long enough to read as a UI hang, with script
// attribution and time since the last worktree switch, into the trace sink.
// Passive: a PerformanceObserver only, nothing on the input or render path.

export const LONG_FRAME_BREADCRUMB = 'renderer_long_frame'
export const LONG_FRAME_THRESHOLD_MS = 200
const MAX_RECORDS_PER_MINUTE = 30

type ScriptTiming = {
  duration: number
  invoker?: string
  invokerType?: string
  sourceURL?: string
  sourceFunctionName?: string
  sourceCharPosition?: number
  forcedStyleAndLayoutDuration?: number
}

type LongFrameEntry = PerformanceEntry & {
  blockingDuration?: number
  styleAndLayoutStart?: number
  renderStart?: number
  scripts?: readonly ScriptTiming[]
}

let lastWorktreeSwitchAt: number | null = null
let installed = false
let recordsThisMinute = 0
let minuteStartedAt = 0

export function noteWorktreeSwitchForLongFrameDiagnostic(): void {
  lastWorktreeSwitchAt = performance.now()
}

function sourceFileName(url: string | undefined): string | null {
  if (!url) {
    return null
  }
  // Why basename: full asar/install paths add nothing to attribution but carry user paths.
  const slash = url.lastIndexOf('/')
  return slash === -1 ? url : url.slice(slash + 1)
}

export function summarizeLongFrame(
  entry: LongFrameEntry,
  switchAt: number | null
): Record<string, string | number | null> {
  const scripts = entry.scripts ?? []
  let top: ScriptTiming | null = null
  let scriptMs = 0
  for (const script of scripts) {
    scriptMs += script.duration
    if (!top || script.duration > top.duration) {
      top = script
    }
  }
  const msSinceSwitch = switchAt === null ? null : Math.round(entry.startTime - switchAt)
  return {
    entryType: entry.entryType,
    durationMs: Math.round(entry.duration),
    blockingMs: entry.blockingDuration === undefined ? null : Math.round(entry.blockingDuration),
    scriptMs: Math.round(scriptMs),
    // Why: render/layout time after the last script separates a React commit storm from layout thrash.
    renderMs:
      entry.renderStart === undefined || entry.renderStart === 0
        ? null
        : Math.round(entry.startTime + entry.duration - entry.renderStart),
    scriptCount: scripts.length,
    topScriptMs: top ? Math.round(top.duration) : null,
    topScriptInvoker: top?.invoker ?? null,
    topScriptInvokerType: top?.invokerType ?? null,
    topScriptFunction: top?.sourceFunctionName || null,
    topScriptSource: sourceFileName(top?.sourceURL),
    topScriptCharPosition: top?.sourceCharPosition ?? null,
    topScriptForcedLayoutMs:
      top?.forcedStyleAndLayoutDuration === undefined
        ? null
        : Math.round(top.forcedStyleAndLayoutDuration),
    // Why: null means no switch yet; a small positive value ties the frame to a switch.
    msSinceWorktreeSwitch: msSinceSwitch !== null && msSinceSwitch >= 0 ? msSinceSwitch : null
  }
}

function takeRecordBudget(now: number): boolean {
  if (now - minuteStartedAt >= 60_000) {
    minuteStartedAt = now
    recordsThisMinute = 0
  }
  recordsThisMinute += 1
  return recordsThisMinute <= MAX_RECORDS_PER_MINUTE
}

function supportedEntryType(): 'long-animation-frame' | 'longtask' | null {
  const supported = PerformanceObserver.supportedEntryTypes ?? []
  if (supported.includes('long-animation-frame')) {
    return 'long-animation-frame'
  }
  return supported.includes('longtask') ? 'longtask' : null
}

export function installLongFrameDiagnostic(): void {
  if (installed || typeof PerformanceObserver === 'undefined') {
    return
  }
  const entryType = supportedEntryType()
  if (!entryType) {
    return
  }
  installed = true
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as LongFrameEntry[]) {
        if (entry.duration < LONG_FRAME_THRESHOLD_MS || !takeRecordBudget(performance.now())) {
          continue
        }
        recordRendererCrashBreadcrumb(
          LONG_FRAME_BREADCRUMB,
          summarizeLongFrame(entry, lastWorktreeSwitchAt)
        )
      }
    })
    observer.observe({ type: entryType, buffered: false })
  } catch {
    // Diagnostics only; an unsupported observer must never affect startup.
  }
}
