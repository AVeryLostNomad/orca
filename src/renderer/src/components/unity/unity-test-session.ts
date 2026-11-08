import { useSyncExternalStore } from 'react'
import type { UnityTestCaseResult, UnityTestMode } from '../../../../shared/unity-types'

export type UnityTestRunSummary = {
  passed: number
  failed: number
  skipped: number
  durationMs: number
}

export type UnityTestModeSession = {
  /** Null until the first list request settles. */
  testNames: string[] | null
  listing: boolean
  listError: string | null
  running: boolean
  runError: string | null
  lastRun: UnityTestRunSummary | null
  /** Latest result per test full name, merged across partial runs. */
  results: ReadonlyMap<string, UnityTestCaseResult>
}

const EMPTY_SESSION: UnityTestModeSession = {
  testNames: null,
  listing: false,
  listError: null,
  running: false,
  runError: null,
  lastRun: null,
  results: new Map()
}

// Session-scoped per project+mode so results survive tab switches and project hops.
const sessions = new Map<string, UnityTestModeSession>()
const listeners = new Set<() => void>()

function sessionKey(projectRoot: string, mode: UnityTestMode): string {
  return `${mode}\0${projectRoot}`
}

function readSession(key: string): UnityTestModeSession {
  return sessions.get(key) ?? EMPTY_SESSION
}

function patchSession(key: string, patch: Partial<UnityTestModeSession>): void {
  sessions.set(key, { ...readSession(key), ...patch })
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useUnityTestSession(
  projectRoot: string,
  mode: UnityTestMode
): UnityTestModeSession {
  const key = sessionKey(projectRoot, mode)
  const getSnapshot = (): UnityTestModeSession => readSession(key)
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export async function loadUnityTests(projectRoot: string, mode: UnityTestMode): Promise<void> {
  const key = sessionKey(projectRoot, mode)
  const listTests = window.api?.unity?.listTests
  if (!listTests || readSession(key).listing) {
    return
  }
  patchSession(key, { listing: true })
  const result = await listTests({ projectRoot, mode }).catch((error: unknown) => ({
    ok: false as const,
    error: String(error)
  }))
  patchSession(
    key,
    result.ok
      ? {
          listing: false,
          listError: null,
          testNames: result.tests.filter((test) => test.mode === mode).map((test) => test.fullName)
        }
      : { listing: false, listError: result.error }
  )
}

/** Runs the named tests, or the whole mode when `fullNames` is null. */
export async function runUnityTests(
  projectRoot: string,
  mode: UnityTestMode,
  fullNames: readonly string[] | null
): Promise<void> {
  const key = sessionKey(projectRoot, mode)
  const runTests = window.api?.unity?.runTests
  if (!runTests || readSession(key).running || fullNames?.length === 0) {
    return
  }
  patchSession(key, { running: true, runError: null })
  const result = await runTests({
    projectRoot,
    mode,
    ...(fullNames ? { filter: fullNames.join(';') } : {})
  }).catch((error: unknown) => ({ ok: false as const, error: String(error) }))
  if (!result.ok) {
    patchSession(key, { running: false, runError: result.error })
    return
  }
  const results = new Map(fullNames ? readSession(key).results : [])
  for (const testCase of result.cases) {
    results.set(testCase.fullName, testCase)
  }
  const { passed, failed, skipped, durationMs } = result
  patchSession(key, { running: false, results, lastRun: { passed, failed, skipped, durationMs } })
}
