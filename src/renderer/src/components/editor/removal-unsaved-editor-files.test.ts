import { describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import type { WorkingDocument, WorkingDocumentId } from '@/store/slices/editor/working-document'
import { registerPendingEditorFlush } from './editor-pending-flush'
import {
  collectRemovalUnsavedFiles,
  flushRemovalPendingEdits,
  lastViewUnsavedFiles,
  unsavedTextViewIds
} from './removal-unsaved-editor-files'

function tab(id: string, filePath: string, worktreeId: string, extra: Partial<OpenFile> = {}) {
  const file: OpenFile = {
    id,
    filePath,
    relativePath: id,
    worktreeId,
    language: 'plaintext',
    isDirty: true,
    mode: 'edit',
    ...extra
  }
  return file
}

function documentOf(id: string, patch: Partial<WorkingDocument> = {}): WorkingDocument {
  return {
    id: id as WorkingDocumentId,
    target: {} as WorkingDocument['target'],
    content: 'text',
    revision: 1,
    isDirty: true,
    loadState: 'ready',
    writable: true,
    alwaysAutoSave: false,
    ...patch
  }
}

/** Each tab id maps to the document id given (defaults to its own id, i.e. unshared). */
function state(
  openFiles: OpenFile[],
  documents: Record<string, Partial<WorkingDocument> & { tabs?: string[] }> = {}
): AppState {
  const workingDocuments: Record<string, WorkingDocument> = {}
  const workingDocumentIdsByTab: Record<string, string[]> = {}
  for (const file of openFiles) {
    if (!Object.values(documents).some((doc) => doc.tabs?.includes(file.id))) {
      workingDocuments[file.id] = documentOf(file.id, documents[file.id])
      workingDocumentIdsByTab[file.id] = [file.id]
    }
  }
  for (const [id, doc] of Object.entries(documents)) {
    for (const tabId of doc.tabs ?? []) {
      workingDocuments[id] = documentOf(id, doc)
      workingDocumentIdsByTab[tabId] = [id]
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these readers touch only the listed fields.
  return {
    openFiles,
    workingDocuments,
    workingDocumentIdsByTab,
    unifiedTabsByWorktree: {},
    worktreesByRepo: {},
    detectedWorktreesByRepo: {},
    folderWorkspaces: [],
    projectGroups: []
  } as unknown as AppState
}

describe('lastViewUnsavedFiles', () => {
  it('lists closing tabs whose document holds unsaved text only', () => {
    const s = state(
      [
        tab('dirty', '/w/a.ts', 'wt'),
        tab('clean', '/w/b.ts', 'wt'),
        tab('elsewhere', '/o/d.ts', 'other')
      ],
      { clean: { isDirty: false } }
    )
    expect(lastViewUnsavedFiles(s, new Set(['dirty', 'clean'])).map((f) => f.id)).toEqual(['dirty'])
  })

  it('skips views without a writable document (read-only or staged diffs)', () => {
    const s = state(
      [
        tab('unstaged', '/w/a.ts', 'wt', { mode: 'diff', diffSource: 'unstaged' }),
        tab('readonly', '/w/c.ts', 'wt', { readOnly: true })
      ],
      { readonly: { writable: false } }
    )
    expect(lastViewUnsavedFiles(s, new Set(['unstaged', 'readonly'])).map((f) => f.id)).toEqual([
      'unstaged'
    ])
  })

  it('skips a file whose shared document still has a view that stays open', () => {
    const shared = state([tab('a', '/w/a.ts', 'wt'), tab('b', '/w/a.ts', 'other')], {
      doc: { tabs: ['a', 'b'] }
    })
    expect(unsavedTextViewIds(shared, shared.openFiles[0]!)).toEqual(['a', 'b'])
    expect(lastViewUnsavedFiles(shared, new Set(['a']))).toEqual([])
    expect(lastViewUnsavedFiles(shared, new Set(['a', 'b']))).toHaveLength(1)
  })
})

describe('collectRemovalUnsavedFiles', () => {
  it('uses the tabs the purge would close, after flushing their delayed views', () => {
    const flushed = vi.fn()
    const kept = vi.fn()
    const unregisterFlushed = registerPendingEditorFlush(
      'a' as WorkingDocumentId,
      'rich',
      1,
      flushed
    )
    const unregisterKept = registerPendingEditorFlush('b' as WorkingDocumentId, 'rich', 1, kept)
    const s = state([tab('a', '/w/a.md', 'wt'), tab('b', '/o/b.md', 'other')])

    const files = collectRemovalUnsavedFiles(() => s, [{ id: 'wt' }])

    expect(files.map((f) => f.id)).toEqual(['a'])
    expect(flushed).toHaveBeenCalledTimes(1)
    expect(kept).not.toHaveBeenCalled()
    unregisterFlushed()
    unregisterKept()
  })

  it('keeps going when a delayed view fails to flush', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const s = state([tab('a', '/w/a.md', 'wt')])
    const unregister = registerPendingEditorFlush('a' as WorkingDocumentId, 'rich', 1, () => {
      throw new Error('boom')
    })
    expect(() => flushRemovalPendingEdits(s, ['a'])).not.toThrow()
    expect(error).toHaveBeenCalled()
    unregister()
    error.mockRestore()
  })
})
