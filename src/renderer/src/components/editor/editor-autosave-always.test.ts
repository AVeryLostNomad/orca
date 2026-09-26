import { describe, expect, it } from 'vitest'
import type { WorkingDocument } from '@/store/slices/editor/working-document'
import {
  canAutoSaveWorkingDocument,
  isAutosaveSuspendedForWorkingDocument
} from './editor-autosave'

const document = {
  id: 'document' as WorkingDocument['id'],
  target: {
    owner: { executionHostId: 'local' as const, runtimeEnvironmentId: null },
    filePath: '/repo/notes.md',
    worktreeId: 'wt-1',
    relativePath: 'notes.md',
    language: 'markdown',
    operationProvenance: {} as WorkingDocument['target']['operationProvenance']
  },
  content: '# Notes',
  revision: 1,
  isDirty: true,
  loadState: 'ready' as const,
  writable: true,
  alwaysAutoSave: true
}

describe('document autosave gates', () => {
  it('honors per-document autosave and holds a live external conflict', () => {
    expect(canAutoSaveWorkingDocument(document)).toBe(true)
    expect(isAutosaveSuspendedForWorkingDocument({ externalMutation: 'changed' })).toBe(true)
  })
})
