import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { StoreApi } from 'zustand'
import type { AppState } from '@/store'
import { createEditorStore } from '@/store/slices/editor-slice-test-harness'
import {
  setTestDraft,
  testDraftOf
} from '@/store/slices/editor/working-document-drafts.test-fixture'
import { getWorkingDocumentForFile } from '@/store/slices/editor/working-document-state'
import {
  __clearSelfWriteRegistryForTests,
  recordSelfWrite
} from '@/components/editor/editor-self-write-registry'

const storeRef = vi.hoisted((): { current: StoreApi<AppState> | null } => ({ current: null }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => storeRef.current?.getState() } }))

import { reconcileEditorTabsAfterOverflow } from './editor-external-watch-overflow'

const PATH = '/repo/guarded.ts'

/** A dirty file whose document was loaded from `baseline` and then edited. */
function openDirtyFile(): StoreApi<AppState> {
  const store = createEditorStore()
  storeRef.current = store
  store.getState().openFile({
    filePath: PATH,
    relativePath: 'guarded.ts',
    worktreeId: 'wt-1',
    language: 'typescript',
    mode: 'edit'
  })
  setTestDraft(store, PATH, 'my edits', 'original')
  return store
}

const documentOf = (store: StoreApi<AppState>) => getWorkingDocumentForFile(store.getState(), PATH)

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  __clearSelfWriteRegistryForTests()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it.each(['original', 'external rewrite'])(
  'compares a dirty document after an unwatched period (%s)',
  async (content) => {
    const store = openDirtyFile()
    let finishRead: () => void = () => undefined
    const readFile = vi.fn(
      () =>
        new Promise((resolve) => {
          finishRead = () => resolve({ content, isBinary: false })
        })
    )
    const writeFile = vi.fn()
    vi.stubGlobal('window', { api: { fs: { readFile, writeFile } } })

    reconcileEditorTabsAfterOverflow({ worktreeId: 'wt-1', worktreePath: '/repo' }, true)
    expect(readFile).toHaveBeenCalled()
    expect(documentOf(store)?.externalMutation).toBeUndefined()
    store.getState().setWorkingDocumentContent(documentOf(store)!.id, 'still typing')
    finishRead()
    await vi.advanceTimersByTimeAsync(0)

    expect(documentOf(store)?.externalMutation).toBe(content === 'original' ? undefined : 'changed')
    expect(store.getState().openFiles[0]?.isDirty).toBe(true)
    expect(testDraftOf(store.getState(), PATH)).toBe('still typing')
    expect(writeFile).not.toHaveBeenCalled()
  }
)

it('leaves a dirty document unmarked when its resync read fails', async () => {
  const store = openDirtyFile()
  const readFile = vi.fn(() => Promise.reject(new Error('connection lost')))
  vi.stubGlobal('window', { api: { fs: { readFile } } })

  reconcileEditorTabsAfterOverflow({ worktreeId: 'wt-1', worktreePath: '/repo' }, true)
  await vi.advanceTimersByTimeAsync(0)

  expect(readFile).toHaveBeenCalled()
  expect(documentOf(store)?.externalMutation).toBeUndefined()
})

it("treats the document's own just-written save as an echo, not an external change", async () => {
  const store = openDirtyFile()
  recordSelfWrite(documentOf(store)!.id, 'saved edits')
  vi.stubGlobal('window', {
    api: { fs: { readFile: vi.fn(async () => ({ content: 'saved edits', isBinary: false })) } }
  })

  reconcileEditorTabsAfterOverflow({ worktreeId: 'wt-1', worktreePath: '/repo' }, true)
  await vi.advanceTimersByTimeAsync(0)

  expect(documentOf(store)?.externalMutation).toBeUndefined()
})
