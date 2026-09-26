import ComparisonWorker from './comparison-worker?worker'
import { getDiskBaselineSignature } from '@/components/editor/diff-content-signature'
import {
  COMPARISON_BUDGET_MS,
  COMPARISON_POLICY_VERSION,
  LIVE_COMPARISON_DEBOUNCE_MS,
  type ComparisonFailure,
  type ComparisonInput,
  type ComparisonRequest,
  type ComparisonResponse,
  type ComparisonResult
} from './comparison-types'

const MAX_CACHE_ENTRIES = 100
const MAX_PENDING_REQUESTS = 64
const WATCHDOG_MS = COMPARISON_BUDGET_MS + LIVE_COMPARISON_DEBOUNCE_MS + 250

export class ComparisonCancellationError extends Error {
  constructor() {
    super('Canceled')
    this.name = 'Canceled'
  }
}

export function isComparisonCancellationError(
  error: unknown
): error is ComparisonCancellationError {
  return error instanceof ComparisonCancellationError
}

type CachedResult = {
  input: ComparisonInput
  result: ComparisonResult
}

type PendingRequest = {
  id: number
  key: string
  input: ComparisonInput
  promise: Promise<ComparisonResult>
  resolve: (result: ComparisonResult) => void
  reject: (error: Error) => void
  waiters: number
  timer: ReturnType<typeof setTimeout>
  watchdog: ReturnType<typeof setTimeout> | undefined
  dispatched: boolean
}

let worker: Worker | null = null
let nextRequestId = 1
const pendingById = new Map<number, PendingRequest>()
const pendingByKey = new Map<string, PendingRequest>()
const cache = new Map<string, CachedResult>()
const failures = new Map<string, string>()
const failureListeners = new Set<(key: string, error: string | null) => void>()

function sourceIdentity(input: ComparisonInput): readonly unknown[] {
  if (input.output !== 'pierre') {
    return []
  }
  return [
    input.oldFile?.name ?? null,
    input.oldFile?.lang ?? null,
    input.newFile?.name ?? null,
    input.newFile?.lang ?? null
  ]
}

// Compact keys never decide equality: cache hits and pending joins compare the raw inputs.
export function getComparisonRequestKey(input: ComparisonInput): string {
  return JSON.stringify([
    COMPARISON_POLICY_VERSION,
    input.output,
    getDiskBaselineSignature(input.originalContent),
    getDiskBaselineSignature(input.modifiedContent),
    input.language,
    input.showWhitespace,
    input.originalVersion,
    input.modifiedVersion,
    input.originalIdentity ?? null,
    input.modifiedIdentity ?? null,
    sourceIdentity(input)
  ])
}

function inputsMatch(a: ComparisonInput, b: ComparisonInput): boolean {
  return (
    a.output === b.output &&
    a.originalContent === b.originalContent &&
    a.modifiedContent === b.modifiedContent &&
    a.language === b.language &&
    a.showWhitespace === b.showWhitespace &&
    a.originalVersion === b.originalVersion &&
    a.modifiedVersion === b.modifiedVersion &&
    a.originalIdentity === b.originalIdentity &&
    a.modifiedIdentity === b.modifiedIdentity &&
    (a.output !== 'pierre' ||
      (b.output === 'pierre' &&
        a.oldFile?.name === b.oldFile?.name &&
        a.oldFile?.contents === b.oldFile?.contents &&
        a.oldFile?.lang === b.oldFile?.lang &&
        a.newFile?.name === b.newFile?.name &&
        a.newFile?.contents === b.newFile?.contents &&
        a.newFile?.lang === b.newFile?.lang))
  )
}

function notifyFailure(key: string, error: string | null): void {
  const previousError = failures.get(key) ?? null
  if (error === null) {
    failures.delete(key)
  } else {
    failures.set(key, error)
    if (failures.size > MAX_CACHE_ENTRIES) {
      failures.delete(failures.keys().next().value!)
    }
  }
  if (previousError === error) {
    return
  }
  for (const listener of failureListeners) {
    listener(key, error)
  }
}

export function subscribeComparisonFailures(
  listener: (key: string, error: string | null) => void
): () => void {
  failureListeners.add(listener)
  return () => failureListeners.delete(listener)
}

export function getComparisonFailure(key: string): string | null {
  return failures.get(key) ?? null
}

function clearPending(pending: PendingRequest): void {
  clearTimeout(pending.timer)
  clearTimeout(pending.watchdog)
  pendingById.delete(pending.id)
  pendingByKey.delete(pending.key)
}

function abandonPending(pending: PendingRequest): void {
  if (!pendingById.has(pending.id)) {
    return
  }
  clearPending(pending)
  if (pending.dispatched) {
    // The worker treats this as best-effort. A late reply is ignored by id.
    worker?.postMessage({ type: 'cancel', id: pending.id })
  }
  pending.reject(new ComparisonCancellationError())
}

function resetWorker(error: Error): void {
  worker?.terminate()
  worker = null
  for (const pending of Array.from(pendingById.values())) {
    clearPending(pending)
    pending.reject(error)
    notifyFailure(pending.key, error.message)
  }
}

function getWorker(): Worker {
  if (worker) {
    return worker
  }
  const nextWorker = new ComparisonWorker()
  nextWorker.onmessage = (event: MessageEvent<ComparisonResponse>) => {
    const response = event.data
    const pending = pendingById.get(response.id)
    if (!pending) {
      return
    }
    clearPending(pending)
    if (response.output === 'error') {
      const failure = response as ComparisonFailure
      const error = new Error(failure.error)
      pending.reject(error)
      notifyFailure(pending.key, error.message)
      return
    }
    if (response.output !== pending.input.output) {
      const error = new Error('Diff comparison worker returned an unexpected result.')
      pending.reject(error)
      notifyFailure(pending.key, error.message)
      return
    }
    cache.set(pending.key, { input: pending.input, result: response })
    while (cache.size > MAX_CACHE_ENTRIES) {
      cache.delete(cache.keys().next().value!)
    }
    pending.resolve(response)
    notifyFailure(pending.key, null)
  }
  nextWorker.onerror = (event) => {
    resetWorker(new Error(event.message || 'Diff comparison worker failed.'))
  }
  nextWorker.onmessageerror = () => {
    resetWorker(new Error('Diff comparison worker returned unreadable data.'))
  }
  worker = nextWorker
  return nextWorker
}

function dispatch(pending: PendingRequest): void {
  if (!pendingById.has(pending.id)) {
    return
  }
  pending.dispatched = true
  pending.watchdog = setTimeout(() => {
    if (!pendingById.has(pending.id)) {
      return
    }
    resetWorker(new Error('Diff comparison exceeded its time limit.'))
  }, WATCHDOG_MS)
  try {
    const request: ComparisonRequest = { ...pending.input, id: pending.id }
    getWorker().postMessage(request)
  } catch (error) {
    resetWorker(error instanceof Error ? error : new Error(String(error)))
  }
}

function waitForPending(pending: PendingRequest, signal?: AbortSignal): Promise<ComparisonResult> {
  pending.waiters += 1
  return new Promise<ComparisonResult>((resolve, reject) => {
    let settled = false
    const finish = (): boolean => {
      if (settled) {
        return false
      }
      settled = true
      pending.waiters -= 1
      signal?.removeEventListener('abort', abort)
      return true
    }
    const abort = (): void => {
      if (finish()) {
        reject(new ComparisonCancellationError())
      }
      if (pending.waiters === 0) {
        abandonPending(pending)
      }
    }
    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    void pending.promise.then(
      (result) => {
        if (finish()) {
          resolve(result)
        }
      },
      (error: Error) => {
        if (finish()) {
          reject(error)
        }
      }
    )
  })
}

export function requestComparison(
  input: ComparisonInput,
  options?: { signal?: AbortSignal }
): Promise<ComparisonResult> {
  const key = getComparisonRequestKey(input)
  const cached = cache.get(key)
  if (cached && inputsMatch(cached.input, input)) {
    return Promise.resolve(cached.result)
  }

  let pending = pendingByKey.get(key)
  if (pending && !inputsMatch(pending.input, input)) {
    abandonPending(pending)
    pending = undefined
  }
  if (!pending) {
    if (pendingById.size >= MAX_PENDING_REQUESTS) {
      const error = new Error('Diff comparison queue is full.')
      notifyFailure(key, error.message)
      return Promise.reject(error)
    }
    const id = nextRequestId++
    let resolveRequest: (result: ComparisonResult) => void = () => undefined
    let rejectRequest: (error: Error) => void = () => undefined
    const promise = new Promise<ComparisonResult>((resolve, reject) => {
      resolveRequest = resolve
      rejectRequest = reject
    })
    // A caller may already be aborted before it can attach to this shared
    // promise. Keep that routine cancellation from becoming unhandled.
    void promise.catch(() => undefined)
    pending = {
      id,
      key,
      input,
      promise,
      resolve: resolveRequest,
      reject: rejectRequest,
      waiters: 0,
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
      watchdog: undefined,
      dispatched: false
    }
    const scheduled = pending
    scheduled.timer = setTimeout(() => dispatch(scheduled), LIVE_COMPARISON_DEBOUNCE_MS)
    pendingById.set(id, pending)
    pendingByKey.set(key, pending)
  }
  return waitForPending(pending, options?.signal)
}

/** Invalidates one pair only; the next provider update recomputes it. */
export function retryComparison(input: ComparisonInput): void {
  const key = getComparisonRequestKey(input)
  cache.delete(key)
  const pending = pendingByKey.get(key)
  if (pending) {
    abandonPending(pending)
  }
  notifyFailure(key, null)
}
