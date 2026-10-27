// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createEditorStore } from './editor-autosave-controller-test-fixture'
import { useEditorContentChangeHandler } from './use-editor-content-change-handler'
import { useIpynbDocumentEditing } from './useIpynbDocumentEditing'
import { parseIpynb } from './ipynb-parse'
import { bumpEditorDiscardEpoch } from './editor-discard-epoch'
import { guardedDocument, retainGuardedDocument } from './editor-save-guarded-disk-fixture'
import { getDiskBaselineSignature } from '../../../../shared/disk-baseline-signature'

const storeRef = vi.hoisted((): { current: ReturnType<typeof createEditorStore> | null } => ({
  current: null
}))

vi.mock('@/store', () => {
  const read = () => {
    if (!storeRef.current) {
      throw new Error('store not set')
    }
    return storeRef.current.getState()
  }
  const useAppStore = Object.assign(
    <T,>(select: (state: ReturnType<typeof read>) => T): T => select(read()),
    { getState: read }
  )
  return { useAppStore }
})

afterEach(cleanup)

function openLoaded(filePath: string, language: string, disk: string) {
  const store = createEditorStore()
  storeRef.current = store
  store.getState().openFile({
    filePath,
    relativePath: filePath.slice('/repo/'.length),
    worktreeId: 'wt-1',
    language,
    mode: 'edit'
  })
  const file = store.getState().openFiles[0]!
  const documentId = retainGuardedDocument(store, file.id)
  const loaded = guardedDocument(store, file.id)
  store
    .getState()
    .acceptWorkingDocumentLoad(documentId, loaded.revision, disk, getDiskBaselineSignature(disk))
  return { store, file, documentId }
}

it('cleans the document when an edit is undone back to the saved text', () => {
  const { store, file, documentId } = openLoaded('/repo/file.ts', 'typescript', 'saved')
  const { result } = renderHook(() => useEditorContentChangeHandler())

  act(() => result.current(documentId, 'saved typed'))
  expect(guardedDocument(store, file.id)).toMatchObject({ content: 'saved typed', isDirty: true })
  expect(store.getState().openFiles[0]?.isDirty).toBe(true)

  act(() => result.current(documentId, 'saved'))
  expect(guardedDocument(store, file.id).isDirty).toBe(false)
  expect(store.getState().openFiles[0]?.isDirty).toBe(false)
})

it.each(['discarded', 'reverted', 'acknowledged'] as const)(
  'leaves the notebook document clean after pending typing is %s back to disk text',
  (resolution) => {
    vi.useFakeTimers()
    const notebookText = (source: string) =>
      JSON.stringify({
        nbformat: 4,
        nbformat_minor: 5,
        metadata: {},
        cells: [{ id: 'cell', cell_type: 'code', metadata: {}, source: [source], outputs: [] }]
      })
    const saved = notebookText('saved')
    const { store, file, documentId } = openLoaded('/repo/clean.ipynb', 'json', saved)
    const hook = renderHook(() => {
      const onChange = useEditorContentChangeHandler()
      const document = guardedDocument(store, file.id)
      return useIpynbDocumentEditing({
        fileId: file.id,
        documentId,
        documentRevision: document.revision,
        content: document.content ?? '',
        notebook: parseIpynb(document.content ?? ''),
        onContentChange: (next) => onChange(documentId, next),
        onDeactivateEditor: () => {}
      })
    })
    try {
      act(() =>
        hook.result.current.updateCellSource(0, resolution === 'acknowledged' ? 'saved' : 'typing')
      )
      if (resolution === 'discarded') {
        // Don't Save since typing began: the pending typing must be dropped silently.
        bumpEditorDiscardEpoch(file.id)
      } else if (resolution === 'reverted') {
        act(() => hook.result.current.updateCellSource(0, 'saved'))
      }
      act(() => vi.advanceTimersByTime(400))
      expect(guardedDocument(store, file.id).isDirty).toBe(false)
      expect(store.getState().openFiles[0]?.isDirty).toBe(false)
      if (resolution !== 'reverted') {
        expect(hook.result.current.sourceDrafts).toEqual({})
      }
    } finally {
      hook.unmount()
      vi.useRealTimers()
    }
  }
)
