import { useAppStore } from '@/store'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'

type PendingEditorFlush = {
  sourceRevision: number
  flush: () => void
}

// A document can be rendered by Monaco, a rich editor, and one or more diff
// surfaces. Keep one producer per surface and flush every other producer before
// accepting an edit so an older serialized rich buffer cannot win a newer edit.
const pendingEditorFlushes = new Map<WorkingDocumentId, Map<string, PendingEditorFlush>>()

export function registerPendingEditorFlush(
  documentId: WorkingDocumentId,
  surfaceId: string,
  sourceRevision: number,
  flush: () => void
): () => void {
  const flushes = pendingEditorFlushes.get(documentId) ?? new Map<string, PendingEditorFlush>()
  pendingEditorFlushes.set(documentId, flushes)
  const entry = { sourceRevision, flush }
  flushes.set(surfaceId, entry)

  return () => {
    const currentFlushes = pendingEditorFlushes.get(documentId)
    if (!currentFlushes || currentFlushes.get(surfaceId) !== entry) {
      return
    }
    currentFlushes.delete(surfaceId)
    if (currentFlushes.size === 0) {
      pendingEditorFlushes.delete(documentId)
    }
  }
}

export function flushPendingEditorChange(
  documentId: WorkingDocumentId,
  exceptSurfaceId?: string
): void {
  const flushes = pendingEditorFlushes.get(documentId)
  if (!flushes) {
    return
  }

  // Snapshot first: flushing synchronously can re-render a producer and replace
  // its registration. The identity/revision check below keeps that replacement
  // from being accidentally flushed as part of the older pass.
  for (const [surfaceId, entry] of Array.from(flushes)) {
    if (surfaceId === exceptSurfaceId || flushes.get(surfaceId) !== entry) {
      continue
    }
    if (useAppStore.getState().workingDocuments[documentId]?.revision !== entry.sourceRevision) {
      continue
    }
    entry.flush()
  }
}
