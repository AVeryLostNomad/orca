import { afterEach, expect, it, vi } from 'vitest'
import { getDiskBaselineSignature } from '../../../../../shared/disk-baseline-signature'
import { createEditorSaveQueue } from '../editor-save-queue'
import { registerPendingEditorFlush } from '../editor-pending-flush'
import { retainGuardedDocument } from '../editor-save-guarded-disk-fixture'
import {
  createEditorStore,
  createFakeEditorDisk,
  stubEditorWindowWithDisk
} from '../editor-autosave-controller-test-fixture'

afterEach(() => vi.unstubAllGlobals())

function setup() {
  const disk = stubEditorWindowWithDisk(createFakeEditorDisk({ '/repo/data.csv': 'header\nold' }))
  const store = createEditorStore()
  store.getState().openFile({
    filePath: '/repo/data.csv',
    relativePath: 'data.csv',
    worktreeId: 'wt-1',
    mode: 'edit',
    language: 'plaintext'
  })
  const file = store.getState().openFiles[0]!
  const documentId = retainGuardedDocument(store, file.id)
  const loaded = store.getState().workingDocuments[documentId]!
  store
    .getState()
    .acceptWorkingDocumentLoad(
      documentId,
      loaded.revision,
      'header\nold',
      getDiskBaselineSignature('header\nold')
    )
  store.getState().setWorkingDocumentContent(documentId, 'header\nprevious')
  const document = () => store.getState().workingDocuments[documentId]!
  const queue = createEditorSaveQueue(store)
  return { disk, store, file, documentId, document, queue }
}

it('a save flushes a pending producer and writes its updated text', async () => {
  const { disk, store, file, documentId, document, queue } = setup()
  const unregister = registerPendingEditorFlush(documentId, 'csv', document().revision, () =>
    store.getState().setWorkingDocumentContent(documentId, 'header\nlatest')
  )
  try {
    await queue.queueSave(documentId, 'autosave')
    expect(disk.files.get(file.filePath)).toBe('header\nlatest')
    expect(document().isDirty).toBe(false)
  } finally {
    unregister()
    queue.dispose()
  }
})

it('a failed pending edit prevents the write and keeps the existing dirty text', async () => {
  const { disk, documentId, document, queue } = setup()
  const unregister = registerPendingEditorFlush(documentId, 'csv', document().revision, () => {
    throw new Error('invalid pending cell')
  })
  try {
    await expect(queue.queueSave(documentId)).rejects.toThrow('invalid pending cell')
    expect(disk.fs.writeFile).not.toHaveBeenCalled()
    expect(document()).toMatchObject({ content: 'header\nprevious', isDirty: true })
  } finally {
    unregister()
    queue.dispose()
  }
})

it('a suspended autosave does not flush a pending cell or write the file', async () => {
  const { disk, store, documentId, document, queue } = setup()
  store.getState().setWorkingDocumentExternalState(documentId, { externalMutation: 'changed' })
  const flush = vi.fn()
  const unregister = registerPendingEditorFlush(documentId, 'csv', document().revision, flush)
  try {
    await queue.queueSave(documentId, 'autosave')
    expect(flush).not.toHaveBeenCalled()
    expect(disk.fs.writeFile).not.toHaveBeenCalled()
  } finally {
    unregister()
    queue.dispose()
  }
})

it('keeps newer text dirty when it lands while an earlier save writes', async () => {
  const { disk, store, documentId, document, queue } = setup()
  let releaseWrite: () => void = () => {
    throw new Error('write not started')
  }
  disk.fs.writeFile.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseWrite = () => resolve({ ok: true })
      })
  )
  try {
    const saving = queue.queueSave(documentId)
    await vi.waitFor(() => expect(disk.fs.writeFile).toHaveBeenCalledTimes(1))
    store.getState().setWorkingDocumentContent(documentId, 'header\nnewer')
    releaseWrite()
    await saving
    expect(document()).toMatchObject({ content: 'header\nnewer', isDirty: true })
  } finally {
    queue.dispose()
  }
})

it('autosave leaves an active CSV input alone, and an explicit save commits it', async () => {
  const { disk, store, documentId, document, queue } = setup()
  const flush = vi.fn(() => store.getState().setWorkingDocumentContent(documentId, 'header\ncell'))
  const unregister = registerPendingEditorFlush(documentId, 'csv', document().revision, flush, {
    skipOnAutosave: true
  })
  try {
    await queue.queueSave(documentId, 'autosave')
    expect(flush).not.toHaveBeenCalled()
    expect(disk.files.get('/repo/data.csv')).toBe('header\nprevious')

    await queue.queueSave(documentId)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(disk.files.get('/repo/data.csv')).toBe('header\ncell')
  } finally {
    unregister()
    queue.dispose()
  }
})
