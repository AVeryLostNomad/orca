import { act } from 'react'
import { expect, it, vi } from 'vitest'
import type { OpenFile } from '@/store/slices/editor'
import type { GitStatusEntry } from '../../../../shared/git-status-types'
import type { DiffContent, FileContent } from './editor-panel-content-types'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

type OneShotMock<T> = {
  mockResolvedValueOnce: (value: T) => void
  mockReturnValueOnce: (value: Promise<T>) => void
}

type ReloadGenerationTestContext = {
  createDeferred: <T>() => Deferred<T>
  createOpenFile: (overrides?: Partial<OpenFile>) => OpenFile
  dispatchExternalFileChange: (file: OpenFile, worktreePath: string) => void
  fileContents: () => Record<string, FileContent>
  diffContents: () => Record<string, DiffContent>
  mocks: {
    getRuntimeGitDiff: OneShotMock<DiffContent>
    readRuntimeFileContent: OneShotMock<FileContent>
  }
  reloadContent: (file: OpenFile) => void
  renderProbe: (
    activeFile: OpenFile | null,
    options?: {
      openFiles?: OpenFile[]
      gitStatusByWorktree?: Record<string, GitStatusEntry[]>
    }
  ) => Promise<void>
}

export function registerReloadGenerationTests({
  createDeferred,
  createOpenFile,
  dispatchExternalFileChange,
  fileContents,
  diffContents,
  mocks,
  reloadContent,
  renderProbe
}: ReloadGenerationTestContext): void {
  it('starts a fresh file read for a forced reload instead of reusing the in-flight read', async () => {
    // A reload nonce on mount makes the lazy-load read and the forced reload
    // fire in the same effect flush, while the first read is still registered
    // in flight. The forced reload must delete that entry and start a new read.
    const activeFile = createOpenFile({ fileContentReloadNonce: 1 })
    const firstRead = createDeferred<FileContent>()
    const secondRead = createDeferred<FileContent>()
    mocks.readRuntimeFileContent.mockReturnValueOnce(firstRead.promise)
    mocks.readRuntimeFileContent.mockReturnValueOnce(secondRead.promise)

    await renderProbe(activeFile)
    await vi.waitFor(() => expect(mocks.readRuntimeFileContent).toHaveBeenCalledTimes(2))

    await act(async () => {
      secondRead.resolve({ content: 'fresh content', isBinary: false })
      await secondRead.promise
    })
    await vi.waitFor(() => expect(fileContents()[activeFile.id]?.content).toBe('fresh content'))
  })

  it('ignores an older file read that resolves after a newer forced read', async () => {
    const activeFile = createOpenFile()
    const staleRead = createDeferred<FileContent>()
    const freshRead = createDeferred<FileContent>()
    mocks.readRuntimeFileContent.mockReturnValueOnce(staleRead.promise)
    mocks.readRuntimeFileContent.mockReturnValueOnce(freshRead.promise)

    await renderProbe(activeFile)
    await vi.waitFor(() => expect(mocks.readRuntimeFileContent).toHaveBeenCalledTimes(1))

    dispatchExternalFileChange(activeFile, '/repo')
    await vi.waitFor(() => expect(mocks.readRuntimeFileContent).toHaveBeenCalledTimes(2))

    await act(async () => {
      freshRead.resolve({ content: 'fresh content', isBinary: false })
      await freshRead.promise
    })
    await vi.waitFor(() => expect(fileContents()[activeFile.id]?.content).toBe('fresh content'))

    // The older read resolving last must not clobber the fresh content.
    await act(async () => {
      staleRead.resolve({ content: 'stale content', isBinary: false })
      await staleRead.promise
    })
    expect(fileContents()[activeFile.id]?.content).toBe('fresh content')
  })

  it('keeps non-tab conflict-review file generations until the load resolves', async () => {
    const activeFile = createOpenFile({
      id: 'wt-1::conflict-review',
      filePath: '/repo',
      relativePath: 'Conflict Review',
      language: 'plaintext',
      mode: 'conflict-review',
      conflictReview: {
        source: 'live-summary',
        snapshotTimestamp: 123,
        entries: [{ path: 'src/conflict.ts', conflictKind: 'both_modified' }]
      }
    })
    const conflictRead = createDeferred<FileContent>()
    mocks.readRuntimeFileContent.mockReturnValueOnce(conflictRead.promise)

    await renderProbe(activeFile, {
      gitStatusByWorktree: {
        'wt-1': [
          {
            path: 'src/conflict.ts',
            status: 'modified',
            area: 'unstaged',
            conflictStatus: 'unresolved',
            conflictKind: 'both_modified'
          }
        ]
      }
    })
    await vi.waitFor(() => expect(mocks.readRuntimeFileContent).toHaveBeenCalledTimes(1))

    await act(async () => {
      conflictRead.resolve({
        content: '<<<<<<< HEAD\ncurrent\n=======\nincoming\n>>>>>>> branch',
        isBinary: false
      })
      await conflictRead.promise
    })

    expect(fileContents()['/repo/src/conflict.ts']?.content).toContain('incoming')
  })

  it('ignores an older file read after closing and reopening the same tab id', async () => {
    const activeFile = createOpenFile()
    const staleRead = createDeferred<FileContent>()
    const freshRead = createDeferred<FileContent>()
    mocks.readRuntimeFileContent.mockReturnValueOnce(staleRead.promise)
    mocks.readRuntimeFileContent.mockReturnValueOnce(freshRead.promise)

    await renderProbe(activeFile)
    await vi.waitFor(() => expect(mocks.readRuntimeFileContent).toHaveBeenCalledTimes(1))

    await renderProbe(null, { openFiles: [] })
    expect(fileContents()[activeFile.id]).toBeUndefined()

    await renderProbe(activeFile)
    await vi.waitFor(() => expect(mocks.readRuntimeFileContent).toHaveBeenCalledTimes(2))

    await act(async () => {
      freshRead.resolve({ content: 'fresh reopen content', isBinary: false })
      await freshRead.promise
    })
    await vi.waitFor(() =>
      expect(fileContents()[activeFile.id]?.content).toBe('fresh reopen content')
    )

    await act(async () => {
      staleRead.resolve({ content: 'stale pre-close content', isBinary: false })
      await staleRead.promise
    })
    expect(fileContents()[activeFile.id]?.content).toBe('fresh reopen content')
  })

  it('ignores an older diff read that resolves after a newer forced diff read', async () => {
    const activeFile = createOpenFile({
      id: 'wt-1::diff::unstaged::file.ts',
      mode: 'diff',
      diffSource: 'unstaged'
    })
    const staleDiff = createDeferred<DiffContent>()
    const freshDiff = createDeferred<DiffContent>()
    mocks.getRuntimeGitDiff.mockReturnValueOnce(staleDiff.promise)
    mocks.getRuntimeGitDiff.mockReturnValueOnce(freshDiff.promise)

    await renderProbe(activeFile)
    await vi.waitFor(() => expect(mocks.getRuntimeGitDiff).toHaveBeenCalledTimes(1))

    dispatchExternalFileChange(activeFile, '/repo')
    await vi.waitFor(() => expect(mocks.getRuntimeGitDiff).toHaveBeenCalledTimes(2))

    await act(async () => {
      freshDiff.resolve({
        kind: 'text',
        originalContent: 'old',
        modifiedContent: 'fresh diff content',
        originalIsBinary: false,
        modifiedIsBinary: false
      })
      await freshDiff.promise
    })
    await vi.waitFor(() =>
      expect(diffContents()[activeFile.id]).toMatchObject({ modifiedContent: 'fresh diff content' })
    )

    await act(async () => {
      staleDiff.resolve({
        kind: 'text',
        originalContent: 'old',
        modifiedContent: 'stale diff content',
        originalIsBinary: false,
        modifiedIsBinary: false
      })
      await staleDiff.promise
    })
    expect(diffContents()[activeFile.id]).toMatchObject({ modifiedContent: 'fresh diff content' })
  })

  it('routes reloadContent for an editable diff to its diff refetch and working-document read', async () => {
    // Why: the changed-on-disk banner's "Reload from Disk" refetches the visible
    // diff while the shared working document retains the writable current side.
    const activeFile = createOpenFile({
      id: 'wt-1::diff::unstaged::file.ts',
      mode: 'diff',
      diffSource: 'unstaged'
    })
    mocks.getRuntimeGitDiff.mockResolvedValueOnce({
      kind: 'text',
      originalContent: 'old',
      modifiedContent: 'first diff content',
      originalIsBinary: false,
      modifiedIsBinary: false
    })
    mocks.getRuntimeGitDiff.mockResolvedValueOnce({
      kind: 'text',
      originalContent: 'old',
      modifiedContent: 'reloaded diff content',
      originalIsBinary: false,
      modifiedIsBinary: false
    })

    await renderProbe(activeFile)
    await vi.waitFor(() =>
      expect(diffContents()[activeFile.id]).toMatchObject({ modifiedContent: 'first diff content' })
    )

    await act(async () => {
      reloadContent(activeFile)
    })

    await vi.waitFor(() =>
      expect(diffContents()[activeFile.id]).toMatchObject({
        modifiedContent: 'reloaded diff content'
      })
    )
    expect(mocks.getRuntimeGitDiff).toHaveBeenCalledTimes(2)
    expect(mocks.readRuntimeFileContent).toHaveBeenCalledTimes(1)
  })

  it('routes reloadContent for an edit tab to a forced file read, not a diff refetch', async () => {
    const activeFile = createOpenFile()
    mocks.readRuntimeFileContent.mockResolvedValueOnce({ content: 'old content', isBinary: false })
    mocks.readRuntimeFileContent.mockResolvedValueOnce({
      content: 'reloaded content',
      isBinary: false
    })

    await renderProbe(activeFile)
    await vi.waitFor(() => expect(fileContents()[activeFile.id]?.content).toBe('old content'))

    await act(async () => {
      reloadContent(activeFile)
    })

    await vi.waitFor(() => expect(fileContents()[activeFile.id]?.content).toBe('reloaded content'))
    expect(mocks.readRuntimeFileContent).toHaveBeenCalledTimes(2)
    expect(mocks.getRuntimeGitDiff).not.toHaveBeenCalled()
  })
}
