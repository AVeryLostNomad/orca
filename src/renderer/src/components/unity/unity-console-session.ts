import { useEffect, useSyncExternalStore } from 'react'
import { appendUnityConsoleRecords, type UnityConsoleRecord } from './unity-console-model'

export type UnityConsoleSession = {
  records: UnityConsoleRecord[]
  /** Opaque editor cursor; kept across Clear so cleared entries never return. */
  cursor: string | null
  nextId: number
  error: string | null
}

const RETAINED_ENTRIES = 2000
const POLL_INTERVAL_MS = 1000
const POLL_LIMIT = 500
const EMPTY_SESSION: UnityConsoleSession = { records: [], cursor: null, nextId: 0, error: null }

// Session-scoped per project so switching sidebar tabs keeps the log and its Clear point.
const sessions = new Map<string, UnityConsoleSession>()
const listeners = new Set<() => void>()

function patchSession(projectRoot: string, patch: Partial<UnityConsoleSession>): void {
  sessions.set(projectRoot, { ...(sessions.get(projectRoot) ?? EMPTY_SESSION), ...patch })
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function clearUnityConsole(projectRoot: string): void {
  patchSession(projectRoot, { records: [] })
}

async function pollOnce(projectRoot: string): Promise<void> {
  const getConsole = window.api?.unity?.getConsole
  if (!getConsole) {
    return
  }
  const cursor = sessions.get(projectRoot)?.cursor ?? null
  const result = await getConsole({ projectRoot, cursor, limit: POLL_LIMIT }).catch(
    (error: unknown) => ({ ok: false as const, error: String(error) })
  )
  if (!result.ok) {
    patchSession(projectRoot, { error: result.error })
    return
  }
  const session = sessions.get(projectRoot) ?? EMPTY_SESSION
  patchSession(projectRoot, {
    cursor: result.cursor ?? session.cursor,
    error: null,
    ...(result.entries.length > 0
      ? {
          records: appendUnityConsoleRecords(
            session.records,
            result.entries,
            session.nextId,
            RETAINED_ENTRIES
          ),
          nextId: session.nextId + result.entries.length
        }
      : {})
  })
}

/** Console state for a project; polls the editor only while `active` (visible and connected). */
export function useUnityConsoleSession(projectRoot: string, active: boolean): UnityConsoleSession {
  useEffect(() => {
    if (!active) {
      return
    }
    let cancelled = false
    let timer: number | undefined
    // Chained timeouts so a slow editor response never stacks overlapping requests.
    const poll = async (): Promise<void> => {
      await pollOnce(projectRoot)
      if (!cancelled) {
        timer = window.setTimeout(poll, POLL_INTERVAL_MS)
      }
    }
    void poll()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [active, projectRoot])
  const getSnapshot = (): UnityConsoleSession => sessions.get(projectRoot) ?? EMPTY_SESSION
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
