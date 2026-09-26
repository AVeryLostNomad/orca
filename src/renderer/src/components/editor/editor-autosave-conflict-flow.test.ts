import { describe, expect, it } from 'vitest'
import type { WorkingDocument } from '@/store/slices/editor/working-document'
import { getWorkingDocumentsForExternalFileChange } from './editor-autosave'

function makeDocument(id: string, runtimeEnvironmentId: string | null): WorkingDocument {
  return {
    id: id as WorkingDocument['id'],
    target: {
      owner: { executionHostId: 'local', runtimeEnvironmentId },
      filePath: '/repo/src/file.ts',
      worktreeId: 'wt-1',
      relativePath: 'src/file.ts',
      language: 'typescript',
      operationProvenance: {} as WorkingDocument['target']['operationProvenance']
    },
    content: 'draft',
    revision: 1,
    isDirty: true,
    loadState: 'ready',
    writable: true,
    alwaysAutoSave: false
  }
}

describe('external document matching', () => {
  it('keeps equal paths on different owners isolated before conflict handling', () => {
    const local = makeDocument('local', null)
    const remote = makeDocument('remote', 'runtime-1')
    const matches = getWorkingDocumentsForExternalFileChange(
      { [local.id]: local, [remote.id]: remote },
      { worktreeId: 'wt-1', worktreePath: '/repo', relativePath: 'src/file.ts' }
    )
    expect(matches).toEqual([local])
  })
})
