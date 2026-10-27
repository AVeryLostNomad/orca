import type { WorkingDocumentId } from '@/store/slices/editor/working-document'

type PendingEditorFlush = {
  sourceRevision: number
  flush: () => void
  /** An active input (e.g. a CSV cell) commits only on explicit saves, never under autosave. */
  skipOnAutosave?: boolean
}

// A document can be rendered by Monaco, a rich editor, and one or more diff
// surfaces. Keep one producer per surface and flush every other producer before
// accepting an edit so an older serialized rich buffer cannot win a newer edit.
// Why no store import: store slices reach this through workspace teardown, and a value import of the store from a slice cycles.
const pendingEditorFlushes = new Map<WorkingDocumentId, Map<string, PendingEditorFlush>>()

export function registerPendingEditorFlush(
  documentId: WorkingDocumentId,
  surfaceId: string,
  sourceRevision: number,
  flush: () => void,
  options?: { skipOnAutosave?: boolean }
): () => void {
  const flushes = pendingEditorFlushes.get(documentId) ?? new Map<string, PendingEditorFlush>()
  pendingEditorFlushes.set(documentId, flushes)
  const entry = { sourceRevision, flush, skipOnAutosave: options?.skipOnAutosave }
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

/** Flushes producers whose source revision is still the document's, read fresh before each flush. */
export function flushPendingEditorChangeAt(
  documentId: WorkingDocumentId,
  currentRevision: () => number | undefined,
  exceptSurfaceId?: string,
  autosave = false
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
    if (currentRevision() !== entry.sourceRevision || (autosave && entry.skipOnAutosave)) {
      continue
    }
    entry.flush()
  }
}
