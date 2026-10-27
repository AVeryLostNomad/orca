import { useCallback, useEffect, useId, useLayoutEffect, useRef, type RefObject } from 'react'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import { registerPendingEditorFlush } from '../editor-pending-flush'
import {
  ORCA_EDITOR_DOCUMENT_SAVED_EVENT,
  type EditorDocumentSavedDetail
} from '../editor-autosave'
import type { CsvTextDocument } from './csv-text-document'
import { editCsvTextCells } from './csv-text-cell-edits'
import type { CsvCellEditSession } from './csv-grid-interaction'

export function useCsvPendingCell({
  fileId,
  documentId,
  documentRevision,
  commit,
  document,
  onContentChange,
  editingRef,
  onSessionChange
}: {
  fileId?: string
  documentId?: WorkingDocumentId
  documentRevision?: number
  commit: () => boolean
  document: CsvTextDocument | null
  onContentChange?: (content: string) => void
  editingRef: RefObject<CsvCellEditSession | null>
  onSessionChange: (session: CsvCellEditSession) => void
}) {
  // Why per pane: two grids of one document each keep their own pending cell.
  const paneId = useId()
  const latest = useRef({ commit, document, onContentChange, onSessionChange })
  useLayoutEffect(() => {
    latest.current = { commit, document, onContentChange, onSessionChange }
  })
  useEffect(() => {
    if (!fileId || !documentId || documentRevision === undefined) {
      return
    }
    const unregister = registerPendingEditorFlush(
      documentId,
      `csv:${fileId}:${paneId}`,
      documentRevision,
      () => {
        if (!latest.current.commit()) {
          throw new Error('Resolve the pending CSV cell edit before saving.')
        }
      },
      // Autosave leaves an active cell input alone; explicit saves commit it.
      { skipOnAutosave: true }
    )
    const saved = (event: Event): void => {
      if (!(event instanceof CustomEvent)) {
        return
      }
      const detail = event.detail as EditorDocumentSavedDetail | undefined
      if (!detail || detail.documentId !== documentId) {
        return
      }
      const draft = editingRef.current
      if (draft && draft.source === detail.content) {
        latest.current.onSessionChange({ ...draft, wasDirty: false })
      }
    }
    window.addEventListener(ORCA_EDITOR_DOCUMENT_SAVED_EVENT, saved)
    return () => {
      unregister()
      window.removeEventListener(ORCA_EDITOR_DOCUMENT_SAVED_EVENT, saved)
    }
  }, [fileId, documentId, documentRevision, editingRef, paneId])
  return useCallback(
    (node: HTMLDivElement | null): void => {
      if (!node) {
        preservePendingCell(editingRef, latest.current)
      }
    },
    [editingRef]
  )
}

/** Preserve active cell text as a draft even when normal commit refuses preview limits. */
function preservePendingCell(
  editingRef: RefObject<CsvCellEditSession | null>,
  snapshot: { document: CsvTextDocument | null; onContentChange?: (content: string) => void }
): void {
  const draft = editingRef.current
  if (!draft || !snapshot.document || draft.source !== snapshot.document.source) {
    return
  }
  snapshot.onContentChange?.(
    editCsvTextCells(
      snapshot.document,
      [{ row: draft.sourceRow, column: draft.position.column, value: draft.value }],
      true
    )
  )
  editingRef.current = null
}
