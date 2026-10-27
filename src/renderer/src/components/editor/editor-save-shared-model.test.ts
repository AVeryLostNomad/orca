// Keep text, disk baseline and conflict state synchronized across workspaces sharing one document.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT,
  requestEditorDocumentSave
} from './editor-autosave'
import { attachEditorAutosaveController } from './editor-autosave-controller'
import { __clearSelfWriteRegistryForTests } from './editor-self-write-registry'
import { createEditorStore } from './editor-autosave-controller-test-fixture'
import {
  keepWorkingDocumentEditsOverExternalChange,
  overwriteDiskWithWorkingDocument,
  reloadWorkingDocumentContentFromDisk
} from './ExternalFileChangeBanner'
import { getDiskBaselineSignature } from '../../../../shared/disk-baseline-signature'
import { ORCA_EDITOR_SAVE_DIRTY_FILES_EVENT } from '../../../../shared/editor-save-events'
import {
  GUARDED_PATH,
  guardedDocument,
  retainGuardedDocument,
  stubGuardedDisk
} from './editor-save-guarded-disk-fixture'
import { makeWorktree } from '@/store/slices/worktrees-slice-test-fixtures'
import { toast } from 'sonner'

const mocks = vi.hoisted(() => ({ readRuntimeFileContent: vi.fn() }))
const storeRef = vi.hoisted((): { current: ReturnType<typeof createEditorStore> | null } => ({
  current: null
}))

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock('@/lib/connection-context', () => ({ getConnectionIdForFile: () => undefined }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => storeRef.current?.getState() } }))
vi.mock('@/runtime/runtime-file-read-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readRuntimeFileContent: mocks.readRuntimeFileContent
}))

function openSharedViews(disk: string, filePath = GUARDED_PATH, language = 'typescript') {
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
  for (const worktreeId of ['wt-1', 'wt-2']) {
    store.getState().openFile({
      filePath,
      relativePath: filePath.slice('/repo/'.length),
      worktreeId,
      language,
      mode: 'edit'
    })
  }
  const [a, b] = store.getState().openFiles.map((file) => file.id)
  for (const id of [a, b]) {
    retainGuardedDocument(store, id)
  }
  const loaded = guardedDocument(store, a)
  store
    .getState()
    .acceptWorkingDocumentLoad(loaded.id, loaded.revision, disk, getDiskBaselineSignature(disk))
  const doc = (id: string) => guardedDocument(store, id)
  const edit = (id: string, text: string): void =>
    store.getState().setWorkingDocumentContent(doc(id).id, text)
  const markChanged = (id: string): void =>
    store.getState().setWorkingDocumentExternalState(doc(id).id, { externalMutation: 'changed' })
  return { store, a, b, doc, edit, markChanged }
}

type ClickAction = { onClick: () => void }

function isClickAction(value: unknown): value is ClickAction {
  return (
    typeof value === 'object' &&
    value !== null &&
    'onClick' in value &&
    typeof value.onClick === 'function'
  )
}

describe('two views sharing one working document', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.readRuntimeFileContent.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    __clearSelfWriteRegistryForTests()
  })

  it('both views resolve to one document', () => {
    const { a, b, doc } = openSharedViews('A')
    expect(doc(a).id).toBe(doc(b).id)
  })

  it.each(['save', 'autosave'] as const)(
    '%s cleans the clean sibling view and moves its baseline',
    async (how) => {
      const disk = stubGuardedDisk({ [GUARDED_PATH]: 'A' })
      const { store, a, b, doc, edit } = openSharedViews('A')
      edit(a, 'X')
      const cleanup = attachEditorAutosaveController(store)
      try {
        await (how === 'save'
          ? requestEditorDocumentSave({ documentId: doc(a).id })
          : vi.advanceTimersByTimeAsync(1500))
        expect(disk.files.get(GUARDED_PATH)).toBe('X')
        expect(doc(b)).toMatchObject({
          isDirty: false,
          content: 'X',
          lastKnownDiskSignature: getDiskBaselineSignature('X')
        })
      } finally {
        cleanup()
      }
    }
  )

  it('Keep keeps the one shared edit on every view and moves the document baseline', async () => {
    stubGuardedDisk({ [GUARDED_PATH]: 'B' })
    const { a, b, doc, edit, markChanged } = openSharedViews('A')
    edit(a, 'mine')
    markChanged(a)
    mocks.readRuntimeFileContent.mockResolvedValue({ content: 'B', isBinary: false })

    keepWorkingDocumentEditsOverExternalChange(doc(a))
    await vi.advanceTimersByTimeAsync(0)

    expect(doc(b).content).toBe('mine')
    expect(doc(b).lastKnownDiskSignature).toBe(getDiskBaselineSignature('B'))
  })

  it('Reload discards the shared edits and settles the conflict for both views', async () => {
    const { a, b, doc, edit, markChanged } = openSharedViews('A')
    edit(a, 'mine')
    markChanged(a)
    mocks.readRuntimeFileContent.mockResolvedValue({ content: 'disk', isBinary: false })

    await reloadWorkingDocumentContentFromDisk(doc(a))

    for (const id of [a, b]) {
      expect(doc(id)).toMatchObject({ content: 'disk', isDirty: false })
      expect(doc(id).externalMutation).toBeUndefined()
    }
  })

  it('Overwrite settles the conflict on both views', async () => {
    const disk = stubGuardedDisk({ [GUARDED_PATH]: 'agent' })
    const { store, a, b, doc, edit, markChanged } = openSharedViews('A')
    edit(a, 'mine')
    markChanged(a)
    const cleanup = attachEditorAutosaveController(store)
    try {
      expect(await overwriteDiskWithWorkingDocument(doc(a))).toBe(true)
      expect(disk.files.get(GUARDED_PATH)).toBe('mine')
      expect(doc(b).externalMutation).toBeUndefined()
      expect(doc(b).lastKnownDiskSignature).toBe(getDiskBaselineSignature('mine'))
    } finally {
      cleanup()
    }
  })

  it.each(['wt-1', 'wt-2'])(
    'an external change named by %s marks the shared edits as conflicting',
    (worktreeId) => {
      stubGuardedDisk({ [GUARDED_PATH]: 'A' })
      const { store, a, b, doc, edit } = openSharedViews('A')
      edit(a, 'mine')
      const cleanup = attachEditorAutosaveController(store)
      try {
        window.dispatchEvent(
          new CustomEvent(ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT, {
            detail: { worktreeId, worktreePath: '/repo', relativePath: 'file.ts' }
          })
        )
        expect(doc(a).externalMutation).toBe('changed')
        expect(doc(b).externalMutation).toBe('changed')
      } finally {
        cleanup()
      }
    }
  )

  it('the quit save writes the shared edits once, cleaning every view', async () => {
    const disk = stubGuardedDisk({ [GUARDED_PATH]: 'A' })
    const { store, a, b, doc, edit } = openSharedViews('A')
    edit(a, 'quit text')
    const cleanup = attachEditorAutosaveController(store)
    try {
      await new Promise<void>((resolve, reject) => {
        window.dispatchEvent(
          new CustomEvent(ORCA_EDITOR_SAVE_DIRTY_FILES_EVENT, {
            detail: { claim: () => undefined, resolve, reject: (m: string) => reject(new Error(m)) }
          })
        )
      })
      expect(disk.writeFile).toHaveBeenCalledTimes(1)
      expect(disk.files.get(GUARDED_PATH)).toBe('quit text')
      expect(doc(b).isDirty).toBe(false)
    } finally {
      cleanup()
    }
  })

  it('a rich view typing during a source view save leaves the document dirty, then saves', async () => {
    const md = '/repo/notes.md'
    let released = false
    let release = (): void => undefined
    const held = new Promise<void>((resolve) => {
      release = () => {
        released = true
        resolve()
      }
    })
    const disk = stubGuardedDisk({ [md]: 'A' }, () => (released ? Promise.resolve() : held))
    const { store, a: code, b: rich, doc, edit } = openSharedViews('A', md, 'markdown')
    store.getState().setMarkdownViewMode(code, 'source')
    edit(code, 'source edit')
    expect(doc(rich).content).toBe('source edit')

    const cleanup = attachEditorAutosaveController(store)
    try {
      const slowSave = requestEditorDocumentSave({ documentId: doc(code).id })
      for (let tick = 0; tick < 20 && disk.writeFile.mock.calls.length === 0; tick += 1) {
        await vi.advanceTimersByTimeAsync(0)
      }
      expect(disk.writeFile).toHaveBeenCalledTimes(1)
      edit(rich, 'source edit, more')
      release()
      await slowSave
      expect(disk.files.get(md)).toBe('source edit')
      expect(doc(code)).toMatchObject({
        content: 'source edit, more',
        isDirty: true,
        lastKnownDiskSignature: getDiskBaselineSignature('source edit')
      })

      await requestEditorDocumentSave({ documentId: doc(rich).id })
      expect(disk.files.get(md)).toBe('source edit, more')
      expect(doc(code).isDirty).toBe(false)
    } finally {
      cleanup()
    }
  })

  it('Reload offers Undo of the discarded shared edits', async () => {
    const { a, b, doc, edit, markChanged } = openSharedViews('A')
    edit(b, 'mine')
    markChanged(b)
    mocks.readRuntimeFileContent.mockResolvedValue({ content: 'disk', isBinary: false })
    const toastMock = vi.mocked(toast)
    toastMock.mockClear()
    await reloadWorkingDocumentContentFromDisk(doc(a))
    expect(doc(b).content).toBe('disk')

    const undo: unknown = toastMock.mock.calls[0]?.[1]?.action
    expect(isClickAction(undo)).toBe(true)
    if (isClickAction(undo)) {
      undo.onClick()
    }

    expect(doc(b)).toMatchObject({ content: 'mine', isDirty: true, externalMutation: 'changed' })
  })

  it('Keep clears the conflict for every view before the disk read settles', () => {
    const { a, b, doc, edit, markChanged } = openSharedViews('A')
    edit(a, 'mine')
    markChanged(a)
    mocks.readRuntimeFileContent.mockReturnValue(new Promise(() => {}))

    keepWorkingDocumentEditsOverExternalChange(doc(a))

    expect(doc(b).externalMutation).toBeUndefined()
  })

  it.each([
    ['in the other workspace', false],
    ['in the other workspace while it shows the Changes view', true]
  ])('Undo of Reload yields to typing since %s, on every view', async (_name, changesView) => {
    const { store, a, b, doc, edit } = openSharedViews('A')
    edit(a, 'mine')
    mocks.readRuntimeFileContent.mockResolvedValue({ content: 'disk', isBinary: false })
    const toastMock = vi.mocked(toast)
    toastMock.mockClear()
    await reloadWorkingDocumentContentFromDisk(doc(a))
    if (changesView) {
      // Changes uses the same document, so switching views must not change sharing.
      store.getState().setEditorViewMode(b, 'changes')
    }
    edit(b, 'typed after reload')

    const undo: unknown = toastMock.mock.calls[0]?.[1]?.action
    expect(isClickAction(undo)).toBe(true)
    if (isClickAction(undo)) {
      undo.onClick()
    }

    expect(doc(a).content).toBe('typed after reload')
    expect(doc(b).externalMutation).toBeUndefined()
  })
})
