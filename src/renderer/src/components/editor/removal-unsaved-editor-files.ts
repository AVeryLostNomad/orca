import type { AppState } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import type { WorktreePurgeTarget } from '@/store/slices/worktree-helpers'
import { worktreePurgeClosedFileIds } from '@/store/slices/worktrees/teardown/worktree-purge-closed-files'
import { getWorkingDocumentForFile } from '@/store/slices/editor/working-document-state'
import { flushPendingEditorChangeAt } from './editor-pending-flush-registry'

function documentOf(state: AppState, file: OpenFile) {
  return getWorkingDocumentForFile(state, file.id)
}

/** Prompt once per writable dirty document only when every view of it is closing. */
export function lastViewUnsavedFiles(state: AppState, closedIds: ReadonlySet<string>): OpenFile[] {
  const seenDocuments = new Set<string>()
  const result: OpenFile[] = []
  const openFiles = state.openFiles ?? []
  for (const file of openFiles) {
    const document = documentOf(state, file)
    if (!closedIds.has(file.id) || !document?.isDirty || !document.writable) {
      continue
    }
    const viewIds = unsavedTextViewIds(state, file)
    if (viewIds.every((id) => closedIds.has(id)) && !seenDocuments.has(document.id)) {
      seenDocuments.add(document.id)
      result.push(file)
    }
  }
  return result
}

/** Open tabs that show the same working document as `file`. */
export function unsavedTextViewIds(state: AppState, file: OpenFile): string[] {
  const documentId = documentOf(state, file)?.id
  if (!documentId) {
    return [file.id]
  }
  const ids = (state.openFiles ?? [])
    .filter((candidate) => documentOf(state, candidate)?.id === documentId)
    .map((candidate) => candidate.id)
  return [...new Set([file.id, ...ids])]
}

/** The freshest text of `file`: its working document holds every surface's committed edits. */
export function currentUnsavedText(state: AppState, file: OpenFile): string | undefined {
  return documentOf(state, file)?.content
}

/** Commits text every delayed view (rich Markdown, CSV, notebook pane) holds for these tabs. */
export function flushRemovalPendingEdits(state: AppState, fileIds: Iterable<string>): void {
  const documentIds = new Set<string>()
  for (const fileId of fileIds) {
    const document = getWorkingDocumentForFile(state, fileId)
    if (document && !documentIds.has(document.id)) {
      documentIds.add(document.id)
      try {
        // Read the passed store, not the app's: a removal may run on another store instance.
        flushPendingEditorChangeAt(document.id, () => state.workingDocuments[document.id]?.revision)
      } catch (error) {
        // Why: a flush failing must not block the removal that asked.
        console.error('[editor] flushing pending edits before a removal failed', error)
      }
    }
  }
}

/** Unsaved files a removal of `targets` would close, after flushing their delayed views. */
export function collectRemovalUnsavedFiles(
  getState: () => AppState,
  targets: readonly WorktreePurgeTarget[]
): OpenFile[] {
  flushRemovalPendingEdits(getState(), worktreePurgeClosedFileIds(getState(), targets))
  const state = getState()
  return lastViewUnsavedFiles(state, worktreePurgeClosedFileIds(state, targets))
}
