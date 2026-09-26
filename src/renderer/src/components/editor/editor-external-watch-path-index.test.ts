import { describe, expect, it } from 'vitest'
import type { WorkingDocument } from '@/store/slices/editor/working-document'
import { indexEditorExternalWatchBatchPaths } from './editor-external-watch-path-index'

function document(id: string, filePath: string): WorkingDocument {
  return {
    id: id as WorkingDocument['id'],
    target: {
      owner: { executionHostId: 'local' as const, runtimeEnvironmentId: null },
      filePath,
      relativePath: 'file.ts',
      worktreeId: 'wt-wsl',
      language: 'typescript',
      operationProvenance: {} as WorkingDocument['target']['operationProvenance']
    },
    content: '',
    revision: 1,
    isDirty: false,
    loadState: 'ready',
    writable: true,
    alwaysAutoSave: false
  }
}

describe('editor external watch path index', () => {
  it('matches a document and reports its deletion by canonical document id', () => {
    const workingDocument = document('document-1', '/repo/file.ts')
    const index = indexEditorExternalWatchBatchPaths(
      {
        worktreePath: '/repo',
        events: [{ kind: 'delete', absolutePath: '/repo/file.ts', isDirectory: false }]
      } as never,
      { [workingDocument.id]: workingDocument },
      { worktreeId: 'wt-wsl', worktreePath: '/repo', runtimeEnvironmentId: null }
    )
    expect(index.deletedWorkingDocuments).toEqual([
      { documentId: workingDocument.id, normalizedDeletePath: '/repo/file.ts' }
    ])
  })

  it('matches updates against retained hidden documents', () => {
    const workingDocument = document('document-1', '/repo/file.ts')
    const index = indexEditorExternalWatchBatchPaths(
      {
        worktreePath: '/repo',
        events: [{ kind: 'modify', absolutePath: '/repo/file.ts', isDirectory: false }]
      } as never,
      { [workingDocument.id]: workingDocument },
      { worktreeId: 'wt-wsl', worktreePath: '/repo', runtimeEnvironmentId: null }
    )
    expect(index.matchingDocumentIds(index.changes[0]!)).toEqual([workingDocument.id])
  })
})
