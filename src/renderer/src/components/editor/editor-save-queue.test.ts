import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkingDocument } from '@/store/slices/editor/working-document'

const writeRuntimeFile = vi.hoisted(() => vi.fn())
vi.mock('@/runtime/runtime-file-client', () => ({ writeRuntimeFile }))
vi.mock('@/lib/editor-file-operation-owner', () => ({
  getEditorFileOperationContext: () => ({
    settings: null,
    worktreeId: 'wt-1',
    worktreePath: '/repo',
    expectedExecutionHostId: 'local'
  })
}))

import { createEditorSaveQueue } from './editor-save-queue'

function makeDocument(): WorkingDocument {
  return {
    id: 'document-1' as WorkingDocument['id'],
    target: {
      owner: { executionHostId: 'local' as const, runtimeEnvironmentId: null },
      filePath: '/repo/file.ts',
      relativePath: 'file.ts',
      worktreeId: 'wt-1',
      language: 'typescript',
      operationProvenance: {} as WorkingDocument['target']['operationProvenance']
    },
    content: 'first',
    revision: 1,
    isDirty: true,
    loadState: 'ready',
    writable: true,
    alwaysAutoSave: false
  }
}

describe('editor document save queue', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps an edit made during an in-flight write dirty after committing the saved baseline', async () => {
    let releaseWrite: (() => void) | undefined
    vi.stubGlobal('window', new EventTarget())
    writeRuntimeFile.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseWrite = resolve
        })
    )
    const document = makeDocument()
    const state = {
      workingDocuments: { [document.id]: document },
      worktreesByRepo: {},
      settings: {},
      commitWorkingDocumentSave: vi.fn((id: WorkingDocument['id'], savedContent: string) => {
        const current = state.workingDocuments[id]
        state.workingDocuments[id] = {
          ...current,
          isDirty: current.content !== savedContent,
          lastKnownDiskSignature: 'saved'
        }
      })
    }
    const queue = createEditorSaveQueue({
      getState: () => state,
      subscribe: () => () => {}
    } as never)
    const save = queue.queueSave(document.id)
    await vi.waitFor(() => expect(writeRuntimeFile).toHaveBeenCalledOnce())
    state.workingDocuments[document.id] = {
      ...state.workingDocuments[document.id],
      content: 'second',
      revision: 2
    }
    releaseWrite?.()
    await save
    expect(state.workingDocuments[document.id]).toMatchObject({ content: 'second', isDirty: true })
    queue.dispose()
  })
})
