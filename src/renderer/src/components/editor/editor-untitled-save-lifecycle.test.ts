import type { StoreApi } from 'zustand/vanilla'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import { attachEditorAutosaveController } from './editor-autosave-controller'
import {
  createFakeEditorDisk,
  createUntitledNoteStore,
  stubEditorWindowWithDisk,
  type FakeEditorDisk
} from './editor-autosave-controller-test-fixture'
import { retainGuardedDocument } from './editor-save-guarded-disk-fixture'
import { __clearSelfWriteRegistryForTests } from './editor-self-write-registry'
import { getDiskBaselineSignature } from '../../../../shared/disk-baseline-signature'

const storeHolder = vi.hoisted((): { store: StoreApi<AppState> | null } => ({ store: null }))

function requireStore(): StoreApi<AppState> {
  if (!storeHolder.store) {
    throw new Error('test store not initialised')
  }
  return storeHolder.store
}

vi.mock('@/store', () => ({ useAppStore: { getState: () => requireStore().getState() } }))
vi.mock('@/lib/connection-context', () => ({ getConnectionIdForFile: vi.fn() }))

const FILE_ID = '/repo/untitled.md'

describe('untitled note save lifecycle', () => {
  let disk: FakeEditorDisk
  let store: StoreApi<AppState>
  let documentId: WorkingDocumentId

  /** The panel loads the note's (empty) disk text into its working document. */
  function loadFromDisk(content: string): void {
    const document = store.getState().workingDocuments[documentId]!
    store
      .getState()
      .acceptWorkingDocumentLoad(
        documentId,
        document.revision,
        content,
        getDiskBaselineSignature(content)
      )
  }

  function typeInto(content: string): void {
    store.getState().setWorkingDocumentContent(documentId, content)
  }

  function isReopenable(): boolean {
    return (store.getState().recentlyClosedEditorTabsByWorktree['wt-1'] ?? []).some(
      (tab) => tab.filePath === FILE_ID
    )
  }

  beforeEach(() => {
    // Why: the window stub binds setTimeout, so fake timers must be installed first for autosave to be drivable.
    vi.useFakeTimers()
    disk = stubEditorWindowWithDisk(createFakeEditorDisk({ [FILE_ID]: '' }))
    store = createUntitledNoteStore('untitled.md')
    storeHolder.store = store
    documentId = retainGuardedDocument(store, FILE_ID)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    __clearSelfWriteRegistryForTests()
    storeHolder.store = null
  })

  it.each([
    ['before its empty content loads', (): void => {}],
    ['after its empty content loads', (): void => loadFromDisk('')]
  ])('still deletes an untouched untitled note closed %s', async (_when, load) => {
    load()

    store.getState().closeFile(FILE_ID)

    await vi.waitFor(() => expect(disk.files.has(FILE_ID)).toBe(false))
    expect(isReopenable()).toBe(false)
  })

  it('keeps the typed note after autosave, then a plain close', async () => {
    loadFromDisk('')
    const cleanup = attachEditorAutosaveController(store)
    try {
      typeInto('my note')
      await vi.advanceTimersByTimeAsync(1500)
      store.getState().closeFile(FILE_ID)
      // Why: drain any stat → delete chain the close scheduled before asserting the note survived.
      await vi.advanceTimersByTimeAsync(0)

      expect(store.getState().openFiles).toHaveLength(0)
      expect(disk.files.get(FILE_ID)).toBe('my note')
      expect(disk.fs.deletePath).not.toHaveBeenCalled()
      expect(isReopenable()).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('deletes the note when its last save emptied it', async () => {
    loadFromDisk('')
    const cleanup = attachEditorAutosaveController(store)
    try {
      typeInto('a')
      await vi.advanceTimersByTimeAsync(1500)
      typeInto('')
      await vi.advanceTimersByTimeAsync(1500)
      expect(disk.files.get(FILE_ID)).toBe('')

      store.getState().closeFile(FILE_ID)

      await vi.waitFor(() => expect(disk.files.has(FILE_ID)).toBe(false))
    } finally {
      cleanup()
    }
  })

  it.each([
    ['while its tab showed the new text', true],
    ['while its tab was in the background', false]
  ])('keeps a note an agent wrote into %s', async (_when, reloaded) => {
    loadFromDisk('')
    disk.files.set(FILE_ID, 'agent text')
    if (reloaded) {
      store
        .getState()
        .discardWorkingDocumentEdits(
          documentId,
          'agent text',
          getDiskBaselineSignature('agent text')
        )
    }

    store.getState().closeFile(FILE_ID)

    // Why: a macrotask drains the stat → delete chain before asserting nothing was removed.
    await vi.advanceTimersByTimeAsync(0)
    expect(disk.files.get(FILE_ID)).toBe('agent text')
    expect(disk.fs.deletePath).not.toHaveBeenCalled()
    // Why: a background tab never reloaded the write, so only the size check knew it was a real note.
    expect(isReopenable()).toBe(reloaded)
  })
})
