// Git discard holds autosave of the file's shared working document, across every workspace view, until Git settles.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  getWorkingDocumentsForExternalFileChange,
  holdDocumentAutosave,
  notifyEditorExternalFileChange
} from './editor-autosave'
import { attachEditorAutosaveController } from './editor-autosave-controller'
import {
  createEditorStore,
  createFakeEditorDisk,
  stubEditorWindowWithDisk
} from './editor-autosave-controller-test-fixture'
import { registerPendingEditorFlush } from './editor-pending-flush'
import { guardedDocument, retainGuardedDocument } from './editor-save-guarded-disk-fixture'
import { makeWorktree } from '@/store/slices/worktrees-slice-test-fixtures'
import { getDiskBaselineSignature } from '../../../../shared/disk-baseline-signature'

const DISCARD_TARGET = { worktreeId: 'wt-1', worktreePath: '/repo', relativePath: 'a.ts' }

const storeRef = vi.hoisted((): { current: ReturnType<typeof createEditorStore> | null } => ({
  current: null
}))
vi.mock('@/store', () => ({ useAppStore: { getState: () => storeRef.current?.getState() } }))
vi.mock('@/lib/connection-context', () => ({ getConnectionIdForFile: () => undefined }))

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function setup(openIn: string[]) {
  const disk = stubEditorWindowWithDisk(createFakeEditorDisk({ '/repo/a.ts': 'saved change' }))
  const store = createEditorStore()
  storeRef.current = store
  store.setState({
    worktreesByRepo: {
      'repo-1': [
        makeWorktree({ id: 'wt-1', repoId: 'repo-1', path: '/repo', hostId: 'local' }),
        makeWorktree({ id: 'wt-2', repoId: 'repo-1', path: '/repo', hostId: 'local' })
      ]
    }
  })
  const ids = openIn.map((worktreeId) =>
    store.getState().openFile({
      filePath: '/repo/a.ts',
      relativePath: 'a.ts',
      worktreeId,
      language: 'typescript',
      mode: 'edit'
    })
  )
  for (const id of ids) {
    retainGuardedDocument(store, id)
  }
  if (ids[0]) {
    const loaded = guardedDocument(store, ids[0])
    store
      .getState()
      .acceptWorkingDocumentLoad(
        loaded.id,
        loaded.revision,
        'saved change',
        getDiskBaselineSignature('saved change')
      )
  }
  const edit = (id: string, text: string): void =>
    store.getState().setWorkingDocumentContent(guardedDocument(store, id).id, text)
  for (const id of ids) {
    edit(id, 'unsaved edit')
  }
  const cleanup = attachEditorAutosaveController(store)
  const writes = (): number => disk.fs.writeFile.mock.calls.length
  return { disk, store, ids, edit, cleanup, writes }
}

/** The discard flow's hold: every document of the path, whichever workspace retained it. */
async function holdPath(store: ReturnType<typeof createEditorStore>): Promise<() => void> {
  const documents = getWorkingDocumentsForExternalFileChange(
    store.getState().workingDocuments,
    DISCARD_TARGET,
    'local'
  )
  const releases = await Promise.all(documents.map((document) => holdDocumentAutosave(document.id)))
  return () => releases.forEach((release) => release())
}

it('git discard in one workspace pauses the same file autosave in another', async () => {
  const { disk, store, ids, edit, cleanup, writes } = setup(['wt-1', 'wt-2'])
  expect(new Set(ids).size).toBe(2)
  try {
    const release = await holdPath(store)
    // Typing in wt-2 while git runs must not start a new autosave of the file.
    edit(ids[1], 'unsaved edit, more')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(writes()).toBe(0)
    disk.files.set('/repo/a.ts', 'HEAD')
    notifyEditorExternalFileChange(DISCARD_TARGET)
    release()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(writes()).toBe(0)
    expect(disk.files.get('/repo/a.ts')).toBe('HEAD')
    expect(guardedDocument(store, ids[1]!)).toMatchObject({
      externalMutation: 'changed',
      content: 'unsaved edit, more'
    })
  } finally {
    cleanup()
  }
})

it('pauses another workspace even when the discarding workspace has no tab of the file', async () => {
  const { disk, store, ids, cleanup, writes } = setup(['wt-2'])
  try {
    const release = await holdPath(store)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(writes()).toBe(0)
    disk.files.set('/repo/a.ts', 'HEAD')
    notifyEditorExternalFileChange(DISCARD_TARGET)
    release()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(disk.files.get('/repo/a.ts')).toBe('HEAD')
    expect(guardedDocument(store, ids[0]!).externalMutation).toBe('changed')
  } finally {
    cleanup()
  }
})

it('a slow git restore writes nothing until it finishes', async () => {
  const { disk, store, cleanup, writes } = setup(['wt-1', 'wt-2'])
  try {
    const release = await holdPath(store)
    await vi.advanceTimersByTimeAsync(30_000)
    disk.files.set('/repo/a.ts', 'HEAD')
    notifyEditorExternalFileChange(DISCARD_TARGET)
    release()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(writes()).toBe(0)
    expect(disk.files.get('/repo/a.ts')).toBe('HEAD')
  } finally {
    cleanup()
  }
})

it('a watcher notice alone does not lift the hold before git finishes', async () => {
  const { store, ids, edit, cleanup, writes } = setup(['wt-2'])
  try {
    const release = await holdPath(store)
    notifyEditorExternalFileChange({ ...DISCARD_TARGET, worktreeId: 'wt-2' })
    store.getState().setWorkingDocumentExternalState(guardedDocument(store, ids[0]!).id, {
      externalMutation: undefined
    })
    edit(ids[0]!, 'typed after the notice')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(writes()).toBe(0)
    release()
  } finally {
    cleanup()
  }
})

it('a failed discard releases the hold at once, so autosave resumes', async () => {
  const { disk, store, cleanup, writes } = setup(['wt-1'])
  try {
    const release = await holdPath(store)
    await vi.advanceTimersByTimeAsync(100)
    release()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(writes()).toBe(1)
    expect(disk.files.get('/repo/a.ts')).toBe('unsaved edit')
  } finally {
    cleanup()
  }
})

it('a quiesce that fails (unresolved CSV cell) fails the discard and releases its hold', async () => {
  const { disk, store, ids, edit, cleanup, writes } = setup(['wt-1'])
  const document = guardedDocument(store, ids[0]!)
  const unregister = registerPendingEditorFlush(document.id, 'csv', document.revision, () => {
    throw new Error('Resolve the pending CSV cell edit before saving.')
  })
  try {
    await expect(holdDocumentAutosave(document.id)).rejects.toThrow('pending CSV cell')
    unregister()
    edit(ids[0]!, 'cell resolved')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(writes()).toBe(1)
    expect(disk.files.get('/repo/a.ts')).toBe('cell resolved')
  } finally {
    unregister()
    cleanup()
  }
})

it("holds another workspace's unstaged diff tab of the file until release", async () => {
  const { disk, store, cleanup, writes } = setup([])
  store.getState().openDiff('wt-2', '/repo/a.ts', 'a.ts', 'typescript', false)
  const diff = store.getState().openFiles[0]!
  expect(diff.diffSource).toBe('unstaged')
  const documentId = retainGuardedDocument(store, diff.id)
  const loaded = guardedDocument(store, diff.id)
  store
    .getState()
    .acceptWorkingDocumentLoad(
      documentId,
      loaded.revision,
      'saved change',
      getDiskBaselineSignature('saved change')
    )
  store.getState().setWorkingDocumentContent(documentId, 'diff edit')
  try {
    const release = await holdPath(store)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(writes()).toBe(0)
    release()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(disk.files.get('/repo/a.ts')).toBe('diff edit')
  } finally {
    cleanup()
  }
})
