import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { requestEditorDocumentSave, toastError } = vi.hoisted(() => ({
  requestEditorDocumentSave: vi.fn(),
  toastError: vi.fn()
}))
vi.mock('./editor-autosave', () => ({ requestEditorDocumentSave }))
vi.mock('sonner', () => ({ toast: { error: toastError } }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

import { attemptEditorDocumentSave } from './editor-file-save-attempt'

describe('attemptEditorDocumentSave', () => {
  beforeEach(() => {
    requestEditorDocumentSave.mockReset()
    toastError.mockClear()
  })
  afterEach(() => vi.restoreAllMocks())

  it('reports success only after the canonical document save resolves', async () => {
    requestEditorDocumentSave.mockResolvedValue(undefined)
    await expect(attemptEditorDocumentSave({ documentId: 'document-1' as never })).resolves.toBe(
      true
    )
    expect(requestEditorDocumentSave).toHaveBeenCalledWith({ documentId: 'document-1' })
  })

  it('keeps shortcut handlers non-throwing when the document write fails', async () => {
    requestEditorDocumentSave.mockRejectedValue(new Error('disk full'))
    await expect(attemptEditorDocumentSave({ documentId: 'document-1' as never })).resolves.toBe(
      false
    )
    expect(toastError).toHaveBeenCalledOnce()
  })
})
