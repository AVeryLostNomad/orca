// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { useStore, type StoreApi } from 'zustand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import { getDiskBaselineSignature } from '../../../shared/disk-baseline-signature'
import {
  createFakeEditorDisk,
  createUntitledNoteStore,
  type FakeEditorDisk
} from './editor/editor-autosave-controller-test-fixture'
import { retainGuardedDocument } from './editor/editor-save-guarded-disk-fixture'
import { __clearSelfWriteRegistryForTests } from './editor/editor-self-write-registry'

const holder = vi.hoisted((): { store: StoreApi<AppState> | null } => ({ store: null }))

function requireStore(): StoreApi<AppState> {
  if (!holder.store) {
    throw new Error('test store not initialised')
  }
  return holder.store
}

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    <T,>(selector: (state: AppState) => T): T => useStore(requireStore(), selector),
    {
      getState: () => requireStore().getState(),
      subscribe: (listener: (state: AppState) => void) => requireStore().subscribe(listener)
    }
  )
}))
vi.mock('@/lib/connection-context', () => ({ getConnectionIdForFile: () => null }))
vi.mock('./terminal/window-close-running-work', () => ({ assessWindowCloseRunningWork: vi.fn() }))
vi.mock('./window-close-request-coordinator', () => ({
  runWithWindowCloseCheckpointScope: (fn: () => unknown) => fn()
}))
vi.mock('@/lib/shutdown-checkpoint-failure-toast', () => ({
  showShutdownCheckpointFailureToast: vi.fn()
}))

const { attachEditorAutosaveController } = await import('./editor/editor-autosave-controller')
const { requestEditorDocumentSave, requestEditorTabClose } =
  await import('./editor/editor-autosave')
const { useTerminalEditorCloseFoundation } = await import('./use-terminal-editor-close-foundation')
const { useTerminalEditorCloseQueue } = await import('./use-terminal-editor-close-queue')
const { useTerminalEditorCloseDialogActions } =
  await import('./use-terminal-editor-close-dialog-actions')

const FILE_ID = '/repo/untitled.md'

type Base = Parameters<typeof useTerminalEditorCloseFoundation>[0]

function mountCloseQueue(store: StoreApi<AppState>) {
  const state = store.getState()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the close hooks read only these projection fields.
  const base = {
    activeWorktreeId: 'wt-1',
    openFiles: state.openFiles,
    closeFile: (fileId: string) => store.getState().closeFile(fileId),
    closeUnifiedTab: vi.fn(),
    discardWorkingDocument: (id: WorkingDocumentId) => store.getState().discardWorkingDocument(id),
    setActiveFile: vi.fn(),
    setActiveTabType: vi.fn(),
    setActiveWorktree: vi.fn()
  } as unknown as Base
  return renderHook(() => {
    const foundation = Object.assign({ ...base }, useTerminalEditorCloseFoundation(base))
    const queue = Object.assign(foundation, useTerminalEditorCloseQueue(foundation))
    return Object.assign(queue, useTerminalEditorCloseDialogActions(queue))
  })
}

// Upstream's "Don't Save" on a never-saved untitled note removed its placeholder; the fork's
// close queue must too, without deleting a note an earlier save made real.
describe("Don't Save on an untitled note", () => {
  let disk: FakeEditorDisk
  let store: StoreApi<AppState>
  let documentId: WorkingDocumentId
  let detachAutosave: () => void

  beforeEach(() => {
    disk = createFakeEditorDisk({ [FILE_ID]: '' })
    Object.assign(window, { api: { fs: disk.fs } })
    store = createUntitledNoteStore('untitled.md')
    // Why: only explicit saves write here, so Don't Save races no autosave.
    store.setState({
      settings: { ...store.getState().settings, editorAutoSave: false } as AppState['settings']
    })
    holder.store = store
    documentId = retainGuardedDocument(store, FILE_ID)
    const loaded = store.getState().workingDocuments[documentId]!
    store
      .getState()
      .acceptWorkingDocumentLoad(documentId, loaded.revision, '', getDiskBaselineSignature(''))
    detachAutosave = attachEditorAutosaveController(store)
  })

  afterEach(() => {
    cleanup()
    detachAutosave()
    __clearSelfWriteRegistryForTests()
    holder.store = null
    Reflect.deleteProperty(window, 'api')
  })

  it("removes a never-saved note's placeholder", async () => {
    store.getState().setWorkingDocumentContent(documentId, 'typed but never saved')
    const { result } = mountCloseQueue(store)
    act(() => requestEditorTabClose(FILE_ID))
    expect(result.current.pendingEditorCloseState?.currentDocumentId).toBe(documentId)

    await act(() => result.current.handleSaveDialogDiscard())

    expect(store.getState().openFiles).toHaveLength(0)
    await vi.waitFor(() => expect(disk.files.has(FILE_ID)).toBe(false))
  })

  it('keeps a note an earlier save made real, dropping only the unsaved edit', async () => {
    store.getState().setWorkingDocumentContent(documentId, 'saved note')
    await requestEditorDocumentSave({ documentId })
    store.getState().setWorkingDocumentContent(documentId, 'saved note, then more')
    const { result } = mountCloseQueue(store)
    act(() => requestEditorTabClose(FILE_ID))

    await act(() => result.current.handleSaveDialogDiscard())

    expect(store.getState().openFiles).toHaveLength(0)
    // Why: a macrotask drains any stat → delete chain the close scheduled.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(disk.files.get(FILE_ID)).toBe('saved note')
    expect(disk.fs.deletePath).not.toHaveBeenCalled()
  })
})
