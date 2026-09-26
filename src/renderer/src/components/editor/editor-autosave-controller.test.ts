import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestEditorDocumentSave } from './editor-autosave'
import { attachEditorAutosaveController } from './editor-autosave-controller'
import { createEditorStore, stubEditorWindow } from './editor-autosave-controller-test-fixture'

describe('editor autosave controller', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('claims a document save request and treats a document removed before handling as settled', async () => {
    stubEditorWindow()
    const store = createEditorStore()
    const detach = attachEditorAutosaveController(store)
    try {
      await expect(
        requestEditorDocumentSave({ documentId: 'removed-document' as never })
      ).resolves.toBeUndefined()
    } finally {
      detach()
    }
  })
})
