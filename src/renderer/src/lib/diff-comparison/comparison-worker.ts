import type { ComparisonFailure, ComparisonRequest, ComparisonResponse } from './comparison-types'
import { computeComparison } from './comparison-engine'

const MAX_PENDING_REQUESTS = 32

const activeRequestIds = new Set<number>()
const cancelledRequestIds = new Set<number>()
let pendingRequestCount = 0

type CancelComparisonRequest = { type: 'cancel'; id: number }

function isCancelComparisonRequest(
  value: ComparisonRequest | CancelComparisonRequest
): value is CancelComparisonRequest {
  return 'type' in value && value.type === 'cancel'
}

function toFailure(request: ComparisonRequest, error: unknown): ComparisonFailure {
  return {
    id: request.id,
    originalVersion: request.originalVersion,
    modifiedVersion: request.modifiedVersion,
    output: 'error',
    error: error instanceof Error ? error.message : String(error)
  }
}

function postResponseIfCurrent(request: ComparisonRequest, response: ComparisonResponse): void {
  if (cancelledRequestIds.delete(request.id)) {
    return
  }
  self.postMessage(response)
}

self.onmessage = (event: MessageEvent<ComparisonRequest | CancelComparisonRequest>) => {
  const message = event.data
  if (isCancelComparisonRequest(message)) {
    if (activeRequestIds.has(message.id)) {
      cancelledRequestIds.add(message.id)
    }
    return
  }
  if (pendingRequestCount >= MAX_PENDING_REQUESTS) {
    postResponseIfCurrent(message, toFailure(message, new Error('Diff comparison queue is full')))
    return
  }
  pendingRequestCount += 1
  activeRequestIds.add(message.id)
  void computeComparison(message).then(
    (response) => {
      pendingRequestCount -= 1
      activeRequestIds.delete(message.id)
      postResponseIfCurrent(message, response)
    },
    (error: unknown) => {
      pendingRequestCount -= 1
      activeRequestIds.delete(message.id)
      postResponseIfCurrent(message, toFailure(message, error))
    }
  )
}
