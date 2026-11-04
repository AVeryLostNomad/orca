import type * as pty from 'node-pty'
import { killConptyNow, terminatePtyJob } from '../../windows/windows-pty-job'

// Bundled ConPTY queries DA1 (or CPR when inheriting the cursor) right after it starts reading
// input, and before relaying any client output. A pane without it never reads keyboard input.
const INPUT_READER_ANNOUNCEMENTS = ['\x1b[c', '\x1b[6n'] as const
// The pseudo-window thread can report window visibility ahead of the announcement.
const WINDOW_VISIBILITY_REPORTS = ['\x1b[1t', '\x1b[2t'] as const

export type ConptyStartupVerdict = 'pending' | 'input-reader' | 'no-input-reader'
export type ConptyStartupOutcome = Exclude<ConptyStartupVerdict, 'pending'> | 'exited' | 'undecided'

// A console shell connects, prompting the announcement, within milliseconds; under heavy CI load
// within ~4s. Past this the pane is handed out unverified rather than stalling the spawn reply.
export const CONPTY_STARTUP_DECISION_LIMIT_MS = 5_000

export const CONPTY_NO_INPUT_READER_NOTICE =
  '\r\n\x1b[31m[Orca] Windows could not start keyboard input for this terminal. Close it and open a new one.\x1b[0m\r\n'

const STARTUP_DA1_QUERY = '\x1b[c'
// Why answer here: ConPTY holds the shell ~3s on its startup DA1 until a reply arrives, and the
// query lands before any client attaches, so no renderer can answer in time. Same reply Orca's
// renderer and runtime give a native ConPTY.
export const CONPTY_STARTUP_DA1_RESPONSE = '\x1b[?61;4c'

function skipWindowVisibilityReports(output: string): number {
  let offset = 0
  for (;;) {
    const report = WINDOW_VISIBILITY_REPORTS.find((candidate) =>
      output.startsWith(candidate, offset)
    )
    if (!report) {
      return offset
    }
    offset += report.length
  }
}

export function classifyConptyStartupOutput(output: string): ConptyStartupVerdict {
  const rest = output.slice(skipWindowVisibilityReports(output))
  if (INPUT_READER_ANNOUNCEMENTS.some((announcement) => rest.startsWith(announcement))) {
    return 'input-reader'
  }
  // A chunk can end mid-sequence; only output that rules out every expected prefix decides.
  const expected = [...INPUT_READER_ANNOUNCEMENTS, ...WINDOW_VISIBILITY_REPORTS]
  return expected.some((sequence) => sequence.startsWith(rest)) ? 'pending' : 'no-input-reader'
}

export type ConptyStartupEvents = {
  data: string[]
  exit: { exitCode: number; signal?: number } | null
}

export type ConptyStartupWatch = {
  /** Settles on the first output that decides, or on exit before any did. */
  verdict: Promise<ConptyStartupOutcome>
  /** Hands buffered output and exit to the caller and stops buffering. */
  claim(): ConptyStartupEvents
}

/** Drop `length` chars at `start` of the joined chunks; a query can straddle chunk boundaries. */
function removeAcrossChunks(chunks: string[], start: number, length: number): string[] {
  const result: string[] = []
  let position = 0
  for (const chunk of chunks) {
    const chunkStart = position
    position += chunk.length
    const cutFrom = Math.max(start - chunkStart, 0)
    const cutTo = Math.min(start + length - chunkStart, chunk.length)
    const kept = cutFrom < cutTo ? chunk.slice(0, cutFrom) + chunk.slice(cutTo) : chunk
    if (kept.length > 0) {
      result.push(kept)
    }
  }
  return result
}

/**
 * Answer ConPTY's startup DA1 so the shell starts without waiting out its timeout, and drop the
 * answered query from replayed output so no later responder types a second reply into the shell.
 */
function answerStartupDeviceAttributes(
  proc: pty.IPty,
  events: ConptyStartupEvents,
  output: string
): void {
  const queryStart = skipWindowVisibilityReports(output)
  if (!output.startsWith(STARTUP_DA1_QUERY, queryStart)) {
    // CPR (cursor inheritance) is not Orca's spawn shape; leave it to the normal responders.
    return
  }
  try {
    proc.write(CONPTY_STARTUP_DA1_RESPONSE)
  } catch {
    // An unanswered query only costs ConPTY's timeout; keep it visible for the other responders.
    return
  }
  events.data = removeAcrossChunks(events.data, queryStart, STARTUP_DA1_QUERY.length)
}

/** Buffers a fresh ConPTY's output until its owner claims it, so no startup byte is lost. */
export function watchConptyStartup(proc: pty.IPty): ConptyStartupWatch {
  const events: ConptyStartupEvents = { data: [], exit: null }
  let output = ''
  let settle: (outcome: ConptyStartupOutcome) => void = () => {}
  const verdict = new Promise<ConptyStartupOutcome>((resolve) => {
    settle = resolve
  })
  let decided = false
  const dataSubscription = proc.onData((data) => {
    events.data.push(data)
    if (decided) {
      return
    }
    output += data
    const classified = classifyConptyStartupOutput(output)
    if (classified !== 'pending') {
      decided = true
      if (classified === 'input-reader') {
        answerStartupDeviceAttributes(proc, events, output)
      }
      settle(classified)
    }
  })
  const exitSubscription = proc.onExit(({ exitCode, signal }) => {
    events.exit = { exitCode, ...(signal !== undefined ? { signal } : {}) }
    decided = true
    settle('exited')
  })
  return {
    verdict,
    claim: () => {
      dataSubscription.dispose()
      exitSubscription.dispose()
      return events
    }
  }
}

async function decideConptyStartup(
  proc: pty.IPty,
  signal: AbortSignal | undefined
): Promise<{ outcome: ConptyStartupOutcome; claim: () => ConptyStartupEvents }> {
  const watch = watchConptyStartup(proc)
  let limit: ReturnType<typeof setTimeout> | undefined
  let onAbort = (): void => {}
  try {
    signal?.throwIfAborted()
    const outcome = await new Promise<ConptyStartupOutcome>((resolve, reject) => {
      onAbort = () => reject(signal?.reason)
      signal?.addEventListener('abort', onAbort, { once: true })
      limit = setTimeout(() => resolve('undecided'), CONPTY_STARTUP_DECISION_LIMIT_MS)
      limit.unref?.()
      void watch.verdict.then(resolve)
    })
    return { outcome, claim: watch.claim }
  } catch (error) {
    // A canceled spawn must not leave the half-started shell running.
    discardConpty(proc, watch)
    throw error
  } finally {
    clearTimeout(limit)
    signal?.removeEventListener('abort', onAbort)
  }
}

function discardConpty(proc: pty.IPty, watch: Pick<ConptyStartupWatch, 'claim'>): void {
  watch.claim()
  // Handle-based only: a pid may already be recycled if the shell exited during startup.
  terminatePtyJob(proc)
  killConptyNow(proc)
  proc.kill()
}

// Why process-wide: the announcement is a fact of the bundled ConPTY build. Until one pane shows
// it, a missing one may mean a newer build changed its startup, not that input is dead.
let announcementObserved = false
let announcementUntrusted = false
// Logged with each respawn so a misfiring check shows up as a climbing count in the daemon log.
let respawnCount = 0

/** Test seam: reset the process-wide trust in the announcement. */
export function _resetConptyStartupTrustForTest(): void {
  announcementObserved = false
  announcementUntrusted = false
  respawnCount = 0
}

function withNotice(claim: () => ConptyStartupEvents): () => ConptyStartupEvents {
  return () => {
    const events = claim()
    return { ...events, data: [...events.data, CONPTY_NO_INPUT_READER_NOTICE] }
  }
}

// Verify ConPTY input before exposing the pane, so respawning cannot repeat user input.
export async function spawnConptyWithInputReader(
  spawn: () => Promise<pty.IPty>,
  opts: {
    label: string
    signal?: AbortSignal
    // Only Orca's default interactive argv is safe to respawn; custom argv may repeat a command.
    respawnSafe: boolean
  }
): Promise<{ proc: pty.IPty; claimStartupEvents: () => ConptyStartupEvents }> {
  const first = await spawn()
  if (announcementUntrusted) {
    return { proc: first, claimStartupEvents: () => ({ data: [], exit: null }) }
  }
  const firstStartup = await decideConptyStartup(first, opts.signal)
  if (firstStartup.outcome === 'input-reader') {
    announcementObserved = true
  }
  if (firstStartup.outcome !== 'no-input-reader') {
    return { proc: first, claimStartupEvents: firstStartup.claim }
  }
  if (!opts.respawnSafe) {
    console.warn(`[daemon/pty] ConPTY for "${opts.label}" started without an input reader`)
    const claim = firstStartup.claim
    return { proc: first, claimStartupEvents: announcementObserved ? withNotice(claim) : claim }
  }
  respawnCount += 1
  console.warn(
    `[daemon/pty] ConPTY for "${opts.label}" started without an input reader; respawning (${respawnCount})`
  )
  discardConpty(first, firstStartup)
  const retry = await spawn()
  const retryStartup = await decideConptyStartup(retry, opts.signal)
  if (retryStartup.outcome === 'input-reader') {
    announcementObserved = true
  }
  if (retryStartup.outcome !== 'no-input-reader') {
    return { proc: retry, claimStartupEvents: retryStartup.claim }
  }
  if (!announcementObserved) {
    // Two misses and no pane ever announced: distrust the check rather than respawn every pane.
    announcementUntrusted = true
    console.warn('[daemon/pty] ConPTY never announced an input reader; disabling the startup check')
    return { proc: retry, claimStartupEvents: retryStartup.claim }
  }
  console.warn(`[daemon/pty] ConPTY for "${opts.label}" again started without an input reader`)
  // After one respawn, show the failure on screen instead of silently ignoring keystrokes.
  return { proc: retry, claimStartupEvents: withNotice(retryStartup.claim) }
}
