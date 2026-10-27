// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { createEditorStore } from '@/store/slices/editor-slice-test-harness'
import { isWorkingDocumentFile } from '@/store/slices/editor/working-document'
import { createEditorSaveQueue } from '../editor-save-queue'
import { retainGuardedDocument } from '../editor-save-guarded-disk-fixture'

const { writeFile } = vi.hoisted(() => ({ writeFile: vi.fn() }))
vi.mock('@/runtime/runtime-file-mutation-client', () => ({ writeRuntimeFile: writeFile }))

it('never gives a paged CSV preview an editable document, so nothing can write it', async () => {
  const store = createEditorStore()
  store.getState().openFile({
    filePath: '/repo/large.csv',
    relativePath: 'large.csv',
    worktreeId: 'wt-1',
    language: 'plaintext',
    mode: 'edit'
  })
  const fileId = store.getState().openFiles[0]!.id
  store.getState().setCsvPreviewOnly(fileId, true)
  expect(isWorkingDocumentFile(store.getState().openFiles[0]!)).toBe(false)

  // Even a retained document stays read-only until a full (non-preview) load lands.
  const documentId = retainGuardedDocument(store, fileId)
  store.getState().setWorkingDocumentContent(documentId, 'partial CSV')
  const document = store.getState().workingDocuments[documentId]!
  expect(document).toMatchObject({ writable: false, isDirty: false, content: undefined })
  const queue = createEditorSaveQueue(store)
  await queue.queueSave(documentId)
  expect(writeFile).not.toHaveBeenCalled()
  queue.dispose()

  store.getState().setCsvPreviewOnly(fileId, false)
  expect(isWorkingDocumentFile(store.getState().openFiles[0]!)).toBe(true)
})
