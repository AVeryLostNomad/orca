import type { WorkingDocumentId } from '@/store/slices/editor/working-document'

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
}

export function clearSelfWrite(documentId: WorkingDocumentId): void {
  stamps.delete(documentId)
}

export function getRecentSelfWrite(documentId: WorkingDocumentId): RecentSelfWrite | null {
  const stamp = stamps.get(documentId)
  if (!stamp) {
    return null
  }
  if (stamp.expiresAt <= Date.now()) {
    stamps.delete(documentId)
    return null
  }
  return { content: stamp.content }
}

export function hasRecentSelfWrite(documentId: WorkingDocumentId): boolean {
  return getRecentSelfWrite(documentId) !== null
}

export function __clearSelfWriteRegistryForTests(): void {
  stamps.clear()
}

export function __getSelfWriteRegistrySizeForTests(): number {
  return stamps.size
}
