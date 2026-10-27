import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@/store/slices/editor'
import type { FileContent } from './editor-panel-content-types'

const setWorkingDocumentExternalState = vi.fn()
const documentState = vi.hoisted(() => ({
  document: { id: 'doc', isDirty: false, lastKnownDiskSignature: 'sig' as string | undefined }
}))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      setWorkingDocumentExternalState,
      workingDocuments: { doc: documentState.document },
      workingDocumentIdsByTab: { '/repo/a.ts': ['doc'] },
      unifiedTabsByWorktree: {}
    })
  }
}))

import {
  applyEditorFileLoadFailure,
  isPathSpecificMissingFileError
} from './editor-deleted-file-reload'

const FILE = '/repo/a.ts'
const tab: OpenFile = {
  id: FILE,
  worktreeId: 'wt',
  filePath: FILE,
  relativePath: 'a.ts',
  language: 'typescript',
  mode: 'edit',
  isDirty: false
}
const failure: FileContent = { content: '', isBinary: false, loadError: 'gone' }
// An older paired server has no existence probe; its read fails with the host's fs message.
const oldServerReadError = new Error(
  "Error invoking runtime method 'files.read': ENOENT: no such file or directory, open '/repo/a.ts'"
)

function apply(error: unknown, previous: Record<string, FileContent>, file = tab) {
  let contents = previous
  applyEditorFileLoadFailure({
    error,
    fileId: FILE,
    filePath: FILE,
    tabs: [file],
    failure,
    setFileContents: (update) => {
      contents = typeof update === 'function' ? update(contents) : update
    }
  })
  return contents
}

describe('applyEditorFileLoadFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    documentState.document = { id: 'doc', isDirty: false, lastKnownDiskSignature: 'sig' }
  })

  it('keeps the last content and marks the tab deleted when an old server reports the file gone on catch-up', () => {
    const contents = apply(oldServerReadError, {
      [FILE]: { content: 'last seen', isBinary: false, isStale: true }
    })

    expect(contents[FILE]).toEqual({ content: 'last seen', isBinary: false, isStale: false })
    expect(setWorkingDocumentExternalState).toHaveBeenCalledWith('doc', {
      externalMutation: 'deleted'
    })
  })

  it.each([
    ['a whole-request not-found', new Error('worktree not found')],
    ['another file', new Error("ENOENT: no such file or directory, open '/repo/b.ts'")],
    ['a connection failure', new Error('Remote connection dropped')]
  ])('shows the read error for %s', (_label, error) => {
    const contents = apply(error, { [FILE]: { content: 'last seen', isBinary: false } })

    expect(contents[FILE]).toBe(failure)
    expect(setWorkingDocumentExternalState).not.toHaveBeenCalled()
  })

  it('never claims a document that has not read the file yet or holds unsaved edits', () => {
    documentState.document = { id: 'doc', isDirty: false, lastKnownDiskSignature: undefined }
    expect(apply(oldServerReadError, {})[FILE]).toBe(failure)
    documentState.document = { id: 'doc', isDirty: true, lastKnownDiskSignature: 'sig' }
    expect(apply(oldServerReadError, {})[FILE]).toBe(failure)
    expect(setWorkingDocumentExternalState).not.toHaveBeenCalled()
  })

  it('matches a path containing an apostrophe', () => {
    expect(
      isPathSpecificMissingFileError(
        new Error("ENOENT: no such file or directory, open '/repo/it's.md'"),
        "/repo/it's.md"
      )
    ).toBe(true)
  })

  it('matches the path regardless of separator spelling', () => {
    expect(
      isPathSpecificMissingFileError(
        new Error("ENOENT: no such file or directory, open 'C:\\repo\\a.ts'"),
        'C:/repo/a.ts'
      )
    ).toBe(true)
  })
})
