import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ORCA_EDITOR_DOCUMENT_SAVED_EVENT,
  quiesceDocumentSave,
  requestEditorDocumentSave,
  type EditorDocumentSaveTarget,
  type EditorDocumentSavedDetail
} from './editor-autosave'
import { attachEditorAutosaveController } from './editor-autosave-controller'
import { __clearSelfWriteRegistryForTests } from './editor-self-write-registry'
import { createEditorStore } from './editor-autosave-controller-test-fixture'
import { keepWorkingDocumentEditsOverExternalChange } from './ExternalFileChangeBanner'
import { attemptEditorDocumentSave } from './editor-file-save-attempt'
import {
  getDiskBaselineSignature,
  getWrittenContentDiskSignature
} from '../../../../shared/disk-baseline-signature'
import {
  GUARDED_PATH,
  guardedDocument,
  openGuardedFile,
  retainGuardedDocument,
  stubGuardedDisk
} from './editor-save-guarded-disk-fixture'
import { makeWorktree } from '@/store/slices/worktrees-slice-test-fixtures'

const mocks = vi.hoisted(() => ({ readRuntimeFileContent: vi.fn(), toastError: vi.fn() }))
const storeRef = vi.hoisted((): { current: ReturnType<typeof createEditorStore> | null } => ({
  current: null
}))

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: mocks.toastError }) }))
vi.mock('@/lib/connection-context', () => ({ getConnectionIdForFile: () => undefined }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => storeRef.current?.getState() } }))
vi.mock('@/runtime/runtime-file-read-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readRuntimeFileContent: mocks.readRuntimeFileContent
}))

type Store = ReturnType<typeof createEditorStore>

function deferred<T = void>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function newStore(): Store {
  const store = createEditorStore()
  storeRef.current = store
  return store
}

function save(
  store: Store,
  fileId: string,
  options: Omit<EditorDocumentSaveTarget, 'documentId'> = {}
): Promise<void> {
  return requestEditorDocumentSave({ documentId: guardedDocument(store, fileId).id, ...options })
}

function edit(store: Store, fileId: string, content: string): void {
  store.getState().setWorkingDocumentContent(guardedDocument(store, fileId).id, content)
}

function markChanged(store: Store, fileId: string): void {
  store.getState().setWorkingDocumentExternalState(guardedDocument(store, fileId).id, {
    externalMutation: 'changed'
  })
}

/** Two workspaces' views of one file share its owner/path working document. */
function openSharedViews(disk: string): { store: Store; a: string; b: string } {
  const store = newStore()
  store.setState({
    worktreesByRepo: {
      'repo-1': [
        makeWorktree({ id: 'wt-1', repoId: 'repo-1', path: '/repo', hostId: 'local' }),
        makeWorktree({ id: 'wt-2', repoId: 'repo-1', path: '/repo', hostId: 'local' })
      ]
    }
  })
  for (const worktreeId of ['wt-1', 'wt-2']) {
    store.getState().openFile({
      filePath: GUARDED_PATH,
      relativePath: 'file.ts',
      worktreeId,
      language: 'typescript',
      mode: 'edit'
    })
  }
  const [a, b] = store.getState().openFiles.map((file) => file.id)
  for (const id of [a, b]) {
    retainGuardedDocument(store, id)
  }
  const document = guardedDocument(store, a)
  store
    .getState()
    .acceptWorkingDocumentLoad(document.id, document.revision, disk, getDiskBaselineSignature(disk))
  return { store, a, b }
}

describe('guarded editor saves under races', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.readRuntimeFileContent.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    __clearSelfWriteRegistryForTests()
    mocks.toastError.mockReset()
  })

  it('guards an unstaged diff tab, which writes the working-tree file', async () => {
    const disk = stubGuardedDisk({ [GUARDED_PATH]: 'agent rewrite' })
    const store = newStore()
    store.getState().openDiff('wt-1', GUARDED_PATH, 'file.ts', 'typescript', false)
    const diff = store.getState().openFiles[0]
    expect(diff?.diffSource).toBe('unstaged')
    const documentId = retainGuardedDocument(store, diff.id)
    const document = guardedDocument(store, diff.id)
    store
      .getState()
      .acceptWorkingDocumentLoad(
        documentId,
        document.revision,
        'original',
        getDiskBaselineSignature('original')
      )
    edit(store, diff.id, 'diff edit')

    const cleanup = attachEditorAutosaveController(store)
    try {
      await vi.advanceTimersByTimeAsync(1500)
      expect(disk.writeFile).toHaveBeenCalledTimes(1)
      expect(disk.files.get(GUARDED_PATH)).toBe('agent rewrite')
      expect(guardedDocument(store, diff.id).externalMutation).toBe('changed')
    } finally {
      cleanup()
    }
  })

  it('rebaselines to its own write even when a quiesce supersedes the save mid-write', async () => {
    const gate = deferred()
    const disk = stubGuardedDisk({ [GUARDED_PATH]: 'original' }, () => gate.promise)
    const store = newStore()
    openGuardedFile(store, { baseline: 'original', draft: 'first' })

    const cleanup = attachEditorAutosaveController(store)
    try {
      const pending = save(store, GUARDED_PATH)
      await vi.advanceTimersByTimeAsync(0)
      const quiesce = quiesceDocumentSave(guardedDocument(store, GUARDED_PATH).id)
      gate.resolve()
      await pending
      await quiesce
      expect(guardedDocument(store, GUARDED_PATH).lastKnownDiskSignature).toBe(
        getWrittenContentDiskSignature('first')
      )

      edit(store, GUARDED_PATH, 'second')
      await save(store, GUARDED_PATH)
      expect(disk.files.get(GUARDED_PATH)).toBe('second')
    } finally {
      cleanup()
    }
  })

  it("does not let Keep's older disk read restamp over a write that finished after it", async () => {
    const gate = deferred()
    stubGuardedDisk({ [GUARDED_PATH]: 'agent rewrite' }, () => gate.promise)
    const store = newStore()
    openGuardedFile(store, { baseline: 'original', draft: 'mine' })
    markChanged(store, GUARDED_PATH)
    const read = deferred<{ content: string; isBinary: boolean }>()
    mocks.readRuntimeFileContent.mockReturnValue(read.promise)

    const cleanup = attachEditorAutosaveController(store)
    try {
      const pending = save(store, GUARDED_PATH, { overwrite: true })
      await vi.advanceTimersByTimeAsync(0)
      keepWorkingDocumentEditsOverExternalChange(guardedDocument(store, GUARDED_PATH))
      gate.resolve()
      await pending
      read.resolve({ content: 'agent rewrite', isBinary: false })
      await vi.advanceTimersByTimeAsync(0)

      expect(guardedDocument(store, GUARDED_PATH).lastKnownDiskSignature).toBe(
        getWrittenContentDiskSignature('mine')
      )
    } finally {
      cleanup()
    }
  })

  it('a sibling view shows the written text after a save, and its next edit saves', async () => {
    const disk = stubGuardedDisk({ [GUARDED_PATH]: 'A' })
    const { store, a: saver, b: sibling } = openSharedViews('A')
    edit(store, saver, 'B')

    const cleanup = attachEditorAutosaveController(store)
    try {
      await save(store, saver)
      expect(guardedDocument(store, sibling).content).toBe('B')

      edit(store, sibling, 'B edited')
      await save(store, sibling)
      expect(disk.files.get(GUARDED_PATH)).toBe('B edited')
    } finally {
      cleanup()
    }
  })

  it('coalesces saves from two views of one document into one write, ending on the saved text', async () => {
    const gate = deferred()
    const disk = stubGuardedDisk({ [GUARDED_PATH]: 'A' }, () => gate.promise)
    const { store, a, b } = openSharedViews('A')
    edit(store, a, 'X')
    const saved: string[] = []
    const onSaved = (event: Event): void => {
      if (event instanceof CustomEvent) {
        saved.push((event.detail as EditorDocumentSavedDetail).content)
      }
    }
    window.addEventListener(ORCA_EDITOR_DOCUMENT_SAVED_EVENT, onSaved)

    const cleanup = attachEditorAutosaveController(store)
    try {
      const saves = Promise.all([save(store, a), save(store, b)])
      gate.resolve()
      await saves

      expect(disk.writeFile).toHaveBeenCalledTimes(1)
      expect(disk.files.get(GUARDED_PATH)).toBe('X')
      expect(saved).toEqual(['X'])
      expect(guardedDocument(store, b)).toMatchObject({
        isDirty: false,
        externalMutation: undefined,
        content: 'X'
      })
    } finally {
      cleanup()
      window.removeEventListener(ORCA_EDITOR_DOCUMENT_SAVED_EVENT, onSaved)
    }
  })

  it('makes Cmd+S in one view wait for Keep My Edits in its sibling', async () => {
    const disk = stubGuardedDisk({ [GUARDED_PATH]: 'B' })
    const { store, a, b } = openSharedViews('A')
    edit(store, a, 'mine')
    markChanged(store, a)
    const read = deferred<{ content: string; isBinary: boolean }>()
    mocks.readRuntimeFileContent.mockReturnValue(read.promise)

    const cleanup = attachEditorAutosaveController(store)
    try {
      keepWorkingDocumentEditsOverExternalChange(guardedDocument(store, a))
      const pending = save(store, b)
      read.resolve({ content: 'B', isBinary: false })
      await pending
      expect(disk.files.get(GUARDED_PATH)).toBe('mine')
    } finally {
      cleanup()
    }
  })

  it('after Keep, every view keeps the kept edits, and the save writes them', async () => {
    const disk = stubGuardedDisk({ [GUARDED_PATH]: 'agent rewrite' })
    const { store, a, b } = openSharedViews('A')
    edit(store, a, 'kept edits')
    markChanged(store, a)
    mocks.readRuntimeFileContent.mockResolvedValue({ content: 'agent rewrite', isBinary: false })

    const cleanup = attachEditorAutosaveController(store)
    try {
      keepWorkingDocumentEditsOverExternalChange(guardedDocument(store, a))
      await vi.advanceTimersByTimeAsync(0)
      expect(guardedDocument(store, b).content).toBe('kept edits')

      await save(store, a)
      expect(disk.files.get(GUARDED_PATH)).toBe('kept edits')
    } finally {
      cleanup()
    }
  })

  it('reports a refused explicit save with the stale-file message', async () => {
    stubGuardedDisk({ [GUARDED_PATH]: 'agent rewrite' })
    const store = newStore()
    openGuardedFile(store, { baseline: 'original', draft: 'mine' })

    const cleanup = attachEditorAutosaveController(store)
    try {
      expect(
        await attemptEditorDocumentSave({ documentId: guardedDocument(store, GUARDED_PATH).id })
      ).toBe(false)
      expect(mocks.toastError).toHaveBeenCalledWith(expect.stringMatching(/changed on disk/))
    } finally {
      cleanup()
    }
  })
})
