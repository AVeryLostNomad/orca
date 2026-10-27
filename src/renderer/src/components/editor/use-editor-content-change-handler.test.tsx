// @vitest-environment happy-dom
import { act, renderHook, cleanup } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import { useEditorContentChangeHandler } from './use-editor-content-change-handler'

afterEach(() => {
  cleanup()
  useAppStore.setState({ openFiles: [], workingDocuments: {}, workingDocumentIdsByTab: {} })
})

/** Opens a CSV tab and loads its working document clean. */
function openLoaded(filePath: string): { fileId: string; documentId: WorkingDocumentId } {
  useAppStore.getState().openFile({
    filePath,
    relativePath: filePath.slice('/repo/'.length),
    mode: 'edit',
    language: 'plaintext',
    worktreeId: 'csv-close-test'
  })
  const fileId = useAppStore.getState().openFiles.find((file) => file.filePath === filePath)!.id
  const documentId = useAppStore.getState().retainWorkingDocument(fileId, {
    owner: { executionHostId: 'local', runtimeEnvironmentId: null },
    filePath,
    worktreeId: 'csv-close-test',
    relativePath: filePath.slice('/repo/'.length),
    language: 'plaintext',
    operationProvenance: {} as never
  })
  const loaded = useAppStore.getState().workingDocuments[documentId]!
  useAppStore.getState().acceptWorkingDocumentLoad(documentId, loaded.revision, 'a,b', 'sig')
  return { fileId, documentId }
}

it('does not recreate a document when a pending editor detaches after its tab was closed', () => {
  const { fileId, documentId } = openLoaded('/repo/closed.csv')
  const { result } = renderHook(() => useEditorContentChangeHandler())
  act(() => {
    useAppStore.getState().releaseWorkingDocumentsForTab(fileId)
    useAppStore.getState().closeFile(fileId)
  })
  act(() => result.current(documentId, 'pending,cell'))
  expect(useAppStore.getState().workingDocuments[documentId]).toBeUndefined()
})

it('retains pending text when the tab is still open but its table view detached', () => {
  const { fileId, documentId } = openLoaded('/repo/open.csv')
  const { result } = renderHook(() => useEditorContentChangeHandler())
  act(() => result.current(documentId, 'pending,cell'))
  expect(useAppStore.getState().workingDocuments[documentId]).toMatchObject({
    content: 'pending,cell',
    isDirty: true
  })
  expect(
    useAppStore.getState().openFiles.find((candidate) => candidate.id === fileId)?.isDirty
  ).toBe(true)
})
