// @vitest-environment happy-dom

import { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import { ORCA_EDITOR_DOCUMENT_SAVED_EVENT } from '../editor-autosave'
import { CSV_RECORD_BYTES } from './csv-byte-index'
import type { CsvCellEditSession } from './csv-grid-interaction'
import { parseCsvTextDocument } from './csv-text-document'
import { useCsvPendingCell } from './useCsvPendingCell'

const DOCUMENT_ID = 'data-document' as WorkingDocumentId

it('keeps an over-limit pending cell as document text when its view closes', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const document = parseCsvTextDocument('a,b\n1,2', ',')
  const huge = 'x'.repeat(CSV_RECORD_BYTES + 1)
  const onContentChange = vi.fn()
  function Probe(): React.JSX.Element {
    const editingRef = useRef<CsvCellEditSession | null>({
      position: { row: 0, column: 1 },
      value: huge,
      sourceRow: 1,
      source: document.source,
      wasDirty: false
    })
    const setRootRef = useCsvPendingCell({
      fileId: 'data.csv',
      documentId: DOCUMENT_ID,
      documentRevision: 1,
      commit: () => false,
      document,
      onContentChange,
      editingRef,
      onSessionChange: () => {}
    })
    return <div ref={setRootRef} />
  }
  const root = createRoot(window.document.createElement('div'))
  await act(async () => root.render(<Probe />))
  // Closing the view detaches its grid root, which preserves the pending cell.
  await act(async () => root.unmount())
  expect(onContentChange).toHaveBeenCalledWith(`a,b\n1,${huge}`)
})

it("marks a pending cell's session clean when another view saved its document's text", async () => {
  const document = parseCsvTextDocument('a,b\n1,2', ',')
  const onSessionChange = vi.fn()
  function Probe(): null {
    const editingRef = useRef<CsvCellEditSession | null>({
      position: { row: 0, column: 1 },
      value: '3',
      sourceRow: 1,
      source: document.source,
      wasDirty: true
    })
    useCsvPendingCell({
      fileId: 'data.csv',
      documentId: DOCUMENT_ID,
      documentRevision: 1,
      commit: () => true,
      document,
      editingRef,
      onSessionChange
    })
    return null
  }
  const root = createRoot(window.document.createElement('div'))
  await act(async () => root.render(<Probe />))
  try {
    // The saving view may have closed mid-write; the document still names this view's text.
    window.dispatchEvent(
      new CustomEvent(ORCA_EDITOR_DOCUMENT_SAVED_EVENT, {
        detail: { documentId: DOCUMENT_ID, content: document.source }
      })
    )
    expect(onSessionChange).toHaveBeenCalledWith(expect.objectContaining({ wasDirty: false }))
  } finally {
    await act(async () => root.unmount())
  }
})
