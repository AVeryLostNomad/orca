import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ComparisonRequest,
  ComparisonResponse,
  MonacoComparisonInput
} from './comparison-types'
type ComparisonWorkerStub = {
  requests: ComparisonRequest[]
  respond(response: ComparisonResponse): void
}

const workerState = vi.hoisted(() => ({
  instances: [] as unknown[]
}))

// Why: Vitest hoists this factory before imports, so its shared state must be
// allocated with vi.hoisted rather than through a normal top-level class.
vi.mock('./comparison-worker?worker', () => ({
  default: class ComparisonWorkerStub {
    onmessage: ((event: MessageEvent<ComparisonResponse>) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    readonly requests: ComparisonRequest[] = []

    constructor() {
      workerState.instances.push(this)
    }

    postMessage(request: ComparisonRequest): void {
      this.requests.push(request)
    }

    terminate(): void {}

    respond(response: ComparisonResponse): void {
      this.onmessage?.({ data: response } as MessageEvent<ComparisonResponse>)
    }
  }
}))

import {
  getComparisonFailure,
  getComparisonRequestKey,
  isComparisonCancellationError,
  requestComparison,
  retryComparison
} from './comparison-client'

const input = (modifiedContent: string): MonacoComparisonInput => ({
  output: 'monaco',
  originalContent: 'const value = 1\n',
  modifiedContent,
  language: 'typescript',
  showWhitespace: false,
  originalVersion: 1,
  modifiedVersion: 2,
  originalIdentity: 'original',
  modifiedIdentity: 'modified'
})

describe('comparison client', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces and shares an exact pair while cancellation stays non-user-facing', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const cancelled = requestComparison(input('const value = 2\n'), { signal: controller.signal })
    const active = requestComparison(input('const value = 2\n'))
    controller.abort()

    await expect(cancelled).rejects.toSatisfy(isComparisonCancellationError)
    await vi.advanceTimersByTimeAsync(150)
    const worker = workerState.instances.at(-1) as ComparisonWorkerStub

    const request = worker.requests[0]!
    worker.respond({
      id: request.id,
      originalVersion: request.originalVersion,
      modifiedVersion: request.modifiedVersion,
      output: 'monaco',
      changes: [],
      identical: false,
      quitEarly: false
    })
    await expect(active).resolves.toMatchObject({ output: 'monaco', identical: false })
    expect(getComparisonFailure(getComparisonRequestKey(input('const value = 2\n')))).toBeNull()

    await expect(requestComparison(input('const value = 2\n'))).resolves.toMatchObject({
      output: 'monaco'
    })
    expect(worker.requests).toHaveLength(1)

    const distinct = requestComparison(input('const value = 3\n'))
    await vi.advanceTimersByTimeAsync(150)
    expect(worker.requests).toHaveLength(2)
    const distinctRequest = worker.requests[1]!
    worker.respond({
      id: distinctRequest.id,
      originalVersion: distinctRequest.originalVersion,
      modifiedVersion: distinctRequest.modifiedVersion,
      output: 'monaco',
      changes: [],
      identical: false,
      quitEarly: false
    })
    await expect(distinct).resolves.toMatchObject({ output: 'monaco' })

    const failingInput = input('const value = 4\n')
    const failed = requestComparison(failingInput)
    await vi.advanceTimersByTimeAsync(150)
    const failedRequest = worker.requests[2]!
    worker.respond({
      id: failedRequest.id,
      originalVersion: failedRequest.originalVersion,
      modifiedVersion: failedRequest.modifiedVersion,
      output: 'error',
      error: 'Tokenizer unavailable'
    })
    await expect(failed).rejects.toThrow('Tokenizer unavailable')
    expect(getComparisonFailure(getComparisonRequestKey(failingInput))).toBe(
      'Tokenizer unavailable'
    )
    retryComparison(failingInput)
    expect(getComparisonFailure(getComparisonRequestKey(failingInput))).toBeNull()
  })
})
