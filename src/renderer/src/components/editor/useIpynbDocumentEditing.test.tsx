// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { WorkingDocument, WorkingDocumentId } from '@/store/slices/editor/working-document'
import { flushPendingEditorChange } from './editor-pending-flush'
import { parseIpynb } from './ipynb-parse'
import { useIpynbDocumentEditing } from './useIpynbDocumentEditing'

const DOCUMENT_ID = 'notebook-document' as WorkingDocumentId

function seedDocument(content: string, revision = 1): void {
  const document: WorkingDocument = {
    id: DOCUMENT_ID,
    target: {} as WorkingDocument['target'],
    content,
    revision,
    isDirty: false,
    loadState: 'ready',
    writable: true,
    alwaysAutoSave: false
  }
  useAppStore.setState({
    workingDocuments: { [DOCUMENT_ID]: document },
    workingDocumentIdsByTab: { 'notebook-a': [DOCUMENT_ID] }
  })
}

function notebookContent(firstSource = 'a', secondSource = 'b'): string {
  return JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { language_info: { name: 'python' } },
    cells: [
      {
        id: 'a',
        cell_type: 'code',
        metadata: {},
        execution_count: null,
        outputs: [],
        source: [firstSource]
      },
      {
        id: 'b',
        cell_type: 'code',
        metadata: {},
        execution_count: null,
        outputs: [],
        source: [secondSource]
      }
    ]
  })
}

describe('notebook document editing lifecycle', () => {
  const animationFrames = new Map<number, FrameRequestCallback>()
  let nextFrameId = 1

  beforeEach(() => {
    vi.useFakeTimers()
    animationFrames.clear()
    nextFrameId = 1
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        const frameId = nextFrameId
        nextFrameId += 1
        animationFrames.set(frameId, callback)
        return frameId
      })
    )
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((frameId: number) => {
        animationFrames.delete(frameId)
      })
    )
    seedDocument(notebookContent())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    useAppStore.setState({ workingDocuments: {}, workingDocumentIdsByTab: {} })
  })

  it('debounces drafts, flushes the latest source, and releases acknowledged drafts', () => {
    const onContentChange = vi.fn()
    const onDeactivateEditor = vi.fn()
    const initialContent = notebookContent()
    seedDocument(initialContent)
    const hook = renderHook(
      ({ content, documentRevision }: { content: string; documentRevision: number }) =>
        useIpynbDocumentEditing({
          content,
          fileId: 'notebook-a',
          documentId: DOCUMENT_ID,
          documentRevision,
          notebook: parseIpynb(content),
          onContentChange,
          onDeactivateEditor
        }),
      { initialProps: { content: initialContent, documentRevision: 1 } }
    )

    act(() => {
      hook.result.current.updateCellSource(0, 'first draft')
      hook.result.current.updateCellSource(0, 'latest draft')
      vi.advanceTimersByTime(399)
    })
    expect(onContentChange).not.toHaveBeenCalled()

    act(() => flushPendingEditorChange(DOCUMENT_ID))
    expect(onContentChange).toHaveBeenCalledTimes(1)
    const committedContent = onContentChange.mock.calls[0]?.[0] as string
    expect(parseIpynb(committedContent).cells[0]?.source).toBe('latest draft')

    hook.rerender({ content: committedContent, documentRevision: 2 })
    expect(Object.hasOwn(hook.result.current.sourceDrafts, 'a')).toBe(false)

    const externalContent = notebookContent('external source')
    seedDocument(externalContent, 3)
    hook.rerender({ content: externalContent, documentRevision: 3 })
    expect(Object.hasOwn(hook.result.current.sourceDrafts, 'a')).toBe(false)
  })
  it('drops a pending cell draft when another surface advances the document', () => {
    const onContentChange = vi.fn()
    const initialContent = notebookContent()
    seedDocument(initialContent)
    const hook = renderHook(
      ({ content, documentRevision }: { content: string; documentRevision: number }) =>
        useIpynbDocumentEditing({
          content,
          fileId: 'notebook-a',
          documentId: DOCUMENT_ID,
          documentRevision,
          notebook: parseIpynb(content),
          onContentChange,
          onDeactivateEditor: vi.fn()
        }),
      { initialProps: { content: initialContent, documentRevision: 1 } }
    )

    act(() => hook.result.current.updateCellSource(0, 'pending rich-style edit'))
    const newerContent = notebookContent('newer Monaco edit')
    seedDocument(newerContent, 2)
    hook.rerender({ content: newerContent, documentRevision: 2 })
    act(() => flushPendingEditorChange(DOCUMENT_ID))

    expect(onContentChange).not.toHaveBeenCalled()
    expect(hook.result.current.sourceDrafts).toEqual({})
  })

  it('flushes drafts before structural work and cancels queued work on detach', () => {
    const onContentChange = vi.fn()
    const onDeactivateEditor = vi.fn()
    const content = notebookContent()
    seedDocument(content)
    const { result } = renderHook(() =>
      useIpynbDocumentEditing({
        content,
        fileId: 'notebook-a',
        documentId: DOCUMENT_ID,
        documentRevision: 1,
        notebook: parseIpynb(content),
        onContentChange,
        onDeactivateEditor
      })
    )

    act(() => {
      result.current.updateCellSource(0, 'edited before move')
      result.current.moveCell(0, 1)
    })
    expect(onDeactivateEditor).toHaveBeenCalledOnce()
    expect(onContentChange).toHaveBeenCalledTimes(1)
    expect(parseIpynb(onContentChange.mock.calls[0]?.[0] as string).cells[0]?.source).toBe(
      'edited before move'
    )
    expect(animationFrames.size).toBe(1)

    const [[frameId, frameCallback]] = [...animationFrames.entries()]
    animationFrames.delete(frameId)
    act(() => frameCallback(0))
    const movedNotebook = parseIpynb(onContentChange.mock.calls[1]?.[0] as string)
    expect(movedNotebook.cells.map((cell) => cell.id)).toEqual(['b', 'a'])
    expect(movedNotebook.cells[1]?.source).toBe('edited before move')

    act(() => result.current.deleteCell(0))
    expect(animationFrames.size).toBe(1)
    act(() => result.current.setRootRef(null))
    expect(cancelAnimationFrame).toHaveBeenCalled()
    expect(animationFrames.size).toBe(0)
  })
})
