import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import { makeWorktree } from '../../worktrees-slice-test-fixtures'
import {
  loadTestDocument,
  setTestDraft,
  testDraftOf
} from '../../editor/working-document-drafts.test-fixture'
import { applyRemoveWorktreeSuccessState } from './remove-worktree-store-cleanup'
import { noticeRemovedUnsavedFiles } from './removed-workspace-unsaved-files'

const show = vi.hoisted(() => vi.fn())
vi.mock('@/components/editor/closed-unsaved-files-toast', () => ({
  showClosedUnsavedFilesToast: show
}))

function tab(id: string, worktreeId: string, patch: Partial<OpenFile> = {}): OpenFile {
  return {
    id,
    filePath: '/repo/a.ts',
    relativePath: 'a.ts',
    worktreeId,
    language: 'typescript',
    isDirty: false,
    mode: 'edit',
    ...patch
  }
}

const state = () => useAppStore.getState()

beforeEach(() => {
  show.mockClear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('window', { api: { pty: { kill: vi.fn() } } })
  useAppStore.setState(useAppStore.getInitialState(), true)
  useAppStore.setState({
    worktreesByRepo: {
      'repo-1': [
        makeWorktree({ id: 'wt-1', repoId: 'repo-1', path: '/repo', hostId: 'local' }),
        makeWorktree({ id: 'wt-2', repoId: 'repo-1', path: '/repo', hostId: 'local' })
      ]
    }
  })
})
afterEach(() => vi.unstubAllGlobals())

it('removing one workspace keeps the shared document and its text in the other', async () => {
  useAppStore.setState({ openFiles: [tab('a', 'wt-1'), tab('b', 'wt-2')] })
  const documentId = setTestDraft(useAppStore, 'a', 'shared edits')
  expect(setTestDraft(useAppStore, 'b', 'shared edits')).toBe(documentId)

  applyRemoveWorktreeSuccessState(useAppStore.setState, 'wt-2', new Set(), 'local')
  await Promise.resolve()

  expect(state().openFiles.map((file) => file.id)).toEqual(['a'])
  // Same document id: the autosave timer and queued save keyed by it carry on.
  expect(state().workingDocumentIdsByTab).toEqual({ a: [documentId] })
  expect(testDraftOf(state(), 'a')).toBe('shared edits')
  expect(state().openFiles[0]?.isDirty).toBe(true)
  expect(show).not.toHaveBeenCalled()
})

it("a removal with no prompt keeps the last view's dirty document; reopening the file joins it", async () => {
  useAppStore.setState({ openFiles: [tab('b', 'wt-2')] })
  const documentId = setTestDraft(useAppStore, 'b', 'only copy')

  applyRemoveWorktreeSuccessState(useAppStore.setState, 'wt-2', new Set(), 'local')
  await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(1))
  expect(state().openFiles).toEqual([])
  expect(state().workingDocuments[documentId]).toMatchObject({
    content: 'only copy',
    isDirty: true
  })

  useAppStore.setState({ openFiles: [tab('a', 'wt-1')] })
  expect(loadTestDocument(useAppStore, 'a')).toBe(documentId)
  expect(testDraftOf(state(), 'a')).toBe('only copy')
  expect(state().openFiles[0]?.isDirty).toBe(true)
})

it('a confirmed removal discards: nothing is kept', () => {
  useAppStore.setState({ openFiles: [tab('b', 'wt-2')] })
  const documentId = setTestDraft(useAppStore, 'b', 'listed and confirmed')
  applyRemoveWorktreeSuccessState(
    useAppStore.setState,
    'wt-2',
    new Set(),
    'local',
    new Map([['b', 'listed and confirmed']])
  )
  expect(state().workingDocuments[documentId]).toBeUndefined()
})

it('a removal closing tabs over several writes keeps every dirty document it closes', async () => {
  useAppStore.setState({
    openFiles: [
      tab('x', 'wt-1', { filePath: '/repo/x.ts' }),
      tab('y', 'wt-2', { filePath: '/repo/y.ts' }),
      tab('z', 'wt-1', { filePath: '/repo/z.ts' })
    ]
  })
  const xDocument = setTestDraft(useAppStore, 'x', 'x edits')
  const yDocument = setTestDraft(useAppStore, 'y', 'y edits')

  // Simulate project batch removal: notice first, close twin separately, close an unrelated tab, then purge the rest.
  noticeRemovedUnsavedFiles(state(), new Set(['x', 'y']))
  state().closeFile('x', { captureRecentlyClosed: false })
  state().closeFile('z')
  state().purgeWorktreeTerminalState(['wt-2'])
  await vi.waitFor(() => expect(show).toHaveBeenCalledTimes(1))

  expect(state().openFiles).toEqual([])
  expect(state().workingDocuments[xDocument]).toMatchObject({ content: 'x edits', isDirty: true })
  expect(state().workingDocuments[yDocument]).toMatchObject({ content: 'y edits', isDirty: true })
  expect(show.mock.calls[0]?.[0].map((file: { content: string }) => file.content).sort()).toEqual([
    'x edits',
    'y edits'
  ])
})
