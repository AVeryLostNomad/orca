import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import { MAX_TIMER_DELAY_MS } from '../../../../shared/timer-delay'

// A completed editor write echoes through the owner watcher. The document id
// already includes owner and canonical path, so it cannot suppress an equal
// path owned by another host.
const SELF_WRITE_TTL_MS = 750
export const SELF_WRITE_REMOTE_TTL_MS = 3000
const SELF_WRITE_MAX_STAMPS = 256

export type RecentSelfWrite = {
  content: string
}

type SelfWriteStamp = RecentSelfWrite & {
  expiresAt: number
}

const stamps = new Map<WorkingDocumentId, SelfWriteStamp>()
let expiryTimer: ReturnType<typeof setTimeout> | null = null
let scheduledExpiryAt = Infinity

function clearExpiryTimer(): void {
  if (expiryTimer !== null) {
    clearTimeout(expiryTimer)
    expiryTimer = null
  }
  scheduledExpiryAt = Infinity
}

// Why: expire saved-content snapshots even while the editor is idle and no echo arrives.
function scheduleExpiredSelfWriteCleanup(): void {
  let nextExpiryAt = Infinity
  for (const stamp of stamps.values()) {
    nextExpiryAt = Math.min(nextExpiryAt, stamp.expiresAt + 1)
  }
  if (nextExpiryAt === Infinity) {
    clearExpiryTimer()
    return
  }
  if (expiryTimer !== null && scheduledExpiryAt <= nextExpiryAt) {
    return
  }
  clearExpiryTimer()
  scheduledExpiryAt = nextExpiryAt
  expiryTimer = setTimeout(
    () => {
      expiryTimer = null
      scheduledExpiryAt = Infinity
      pruneExpiredSelfWrites()
      scheduleExpiredSelfWriteCleanup()
    },
    Math.min(MAX_TIMER_DELAY_MS, Math.max(0, nextExpiryAt - Date.now()))
  )
}

function pruneExpiredSelfWrites(now = Date.now()): void {
  for (const [documentId, stamp] of stamps) {
    if (stamp.expiresAt <= now) {
      stamps.delete(documentId)
    }
  }
}

function enforceSelfWriteStampLimit(): void {
  while (stamps.size > SELF_WRITE_MAX_STAMPS) {
    const oldest = stamps.keys().next().value
    if (oldest === undefined) {
      return
    }
    stamps.delete(oldest)
  }
}

export function recordSelfWrite(
  documentId: WorkingDocumentId,
  content: string,
  ttlMs: number = SELF_WRITE_TTL_MS
): void {
  const now = Date.now()
  pruneExpiredSelfWrites(now)
  stamps.delete(documentId)
  stamps.set(documentId, { content, expiresAt: now + ttlMs })
  enforceSelfWriteStampLimit()
  scheduleExpiredSelfWriteCleanup()
}

export function clearSelfWrite(documentId: WorkingDocumentId): void {
  stamps.delete(documentId)
  if (stamps.size === 0) {
    clearExpiryTimer()
  }
}

export function getRecentSelfWrite(documentId: WorkingDocumentId): RecentSelfWrite | null {
  const stamp = stamps.get(documentId)
  if (!stamp) {
    return null
  }
  if (stamp.expiresAt <= Date.now()) {
    stamps.delete(documentId)
    if (stamps.size === 0) {
      clearExpiryTimer()
    }
    return null
  }
  return { content: stamp.content }
}

export function hasRecentSelfWrite(documentId: WorkingDocumentId): boolean {
  return getRecentSelfWrite(documentId) !== null
}

export function __clearSelfWriteRegistryForTests(): void {
  clearExpiryTimer()
  stamps.clear()
}

export function __getSelfWriteRegistrySizeForTests(): number {
  return stamps.size
}
