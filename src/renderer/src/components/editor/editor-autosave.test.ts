import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkingDocument } from '@/store/slices/editor/working-document'
import {
  canAutoSaveWorkingDocument,
  quiesceDocumentSave,
  requestEditorDocumentSave
} from './editor-autosave'

function makeDocument(overrides: Partial<WorkingDocument> = {}): WorkingDocument {
  return {
    id: 'document-1' as WorkingDocument['id'],
    target: {
      owner: { executionHostId: 'local', runtimeEnvironmentId: null },
      filePath: '/repo/file.ts',
      worktreeId: 'wt-1',
      relativePath: 'file.ts',
      language: 'typescript',
      operationProvenance: {} as WorkingDocument['target']['operationProvenance']
    },
    content: 'text',
    revision: 1,
    isDirty: true,
    loadState: 'ready',
    writable: true,
    alwaysAutoSave: false,
    ...overrides
  }
}

describe('document save API', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('only autosaves ready writable canonical documents', () => {
    expect(canAutoSaveWorkingDocument(makeDocument())).toBe(true)
    expect(canAutoSaveWorkingDocument(makeDocument({ writable: false }))).toBe(false)
    expect(canAutoSaveWorkingDocument(makeDocument({ loadState: 'loading' }))).toBe(false)
    expect(canAutoSaveWorkingDocument(makeDocument({ content: undefined }))).toBe(false)
  })

  it('rejects an unclaimed document save rather than reporting a dropped save', async () => {
    vi.stubGlobal('window', new EventTarget())
    await expect(
      requestEditorDocumentSave({ documentId: 'document-1' as WorkingDocument['id'] })
    ).rejects.toThrow('Editor save controller is unavailable.')
  })

  it('lets a document quiesce proceed when no editor controller is mounted', async () => {
    vi.stubGlobal('window', new EventTarget())
    await expect(
      quiesceDocumentSave('document-1' as WorkingDocument['id'])
    ).resolves.toBeUndefined()
  })
})
