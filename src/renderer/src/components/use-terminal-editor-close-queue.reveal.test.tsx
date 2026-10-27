// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import type * as EditorAutosaveModule from './editor/editor-autosave'

type FakeOpenFile = { id: string; worktreeId: string; isDirty: boolean; relativePath: string }
type FakeDocument = { id: string; isDirty: boolean; revision: number; target: { relativePath: string } }
const store = vi.hoisted(
  (): {
    openFiles: FakeOpenFile[]
    activeWorktreeId: string | null
    workingDocuments: Record<string, FakeDocument>
    workingDocumentIdsByTab: Record<string, string[]>
  } => ({
    openFiles: [],
    activeWorktreeId: 'wt-main',
    workingDocuments: {},
    workingDocumentIdsByTab: {}
  })
)
const revealFloatingWorkspacePanel = vi.hoisted(() => vi.fn())

vi.mock('../store', () => {
  const getState = () => ({
    ...store,
    unifiedTabsByWorktree: {},
    activeWorkspaceExecutionHostId: null,
    setActiveWorktree,
    closeFile
  })
  return {
    useAppStore: Object.assign(
      (selector: (state: ReturnType<typeof getState>) => unknown) => selector(getState()),
      { getState, subscribe: () => () => {} }
    )
  }
})
vi.mock('@/lib/floating-workspace-panel-reveal', () => ({ revealFloatingWorkspacePanel }))
vi.mock('./terminal/window-close-running-work', () => ({ assessWindowCloseRunningWork: vi.fn() }))
vi.mock('./window-close-request-coordinator', () => ({
  runWithWindowCloseCheckpointScope: (fn: () => unknown) => fn()
}))
vi.mock('@/lib/shutdown-checkpoint-failure-toast', () => ({
  showShutdownCheckpointFailureToast: vi.fn()
}))
vi.mock('./editor/editor-autosave', async (importActual) => ({
  ...(await importActual<typeof EditorAutosaveModule>()),
  quiesceDocumentSave: vi.fn(async () => {})
}))

const { useTerminalEditorCloseFoundation } = await import('./use-terminal-editor-close-foundation')
const { useTerminalEditorCloseQueue } = await import('./use-terminal-editor-close-queue')
const { useTerminalEditorCloseDialogActions } =
  await import('./use-terminal-editor-close-dialog-actions')
const { requestEditorTabClose } = await import('./editor/editor-autosave')

const setActiveWorktree = vi.fn()
const setActiveFile = vi.fn()
const setActiveTabType = vi.fn()
const closeFile = vi.fn((fileId: string) => {
  store.openFiles = store.openFiles.filter((file) => file.id !== fileId)
  delete store.workingDocumentIdsByTab[fileId]
})
const discardWorkingDocument = vi.fn((documentId: string) => {
  const document = store.workingDocuments[documentId]
  if (document) {
    store.workingDocuments[documentId] = { ...document, isDirty: false }
  }
})

type Base = Parameters<typeof useTerminalEditorCloseFoundation>[0]

function mountCloseQueue() {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the close hooks read only these projection fields; the rest of the workspace projection is unused here.
  const base = {
    activeWorktreeId: store.activeWorktreeId,
    openFiles: store.openFiles,
    closeFile,
    closeUnifiedTab: vi.fn(),
    discardWorkingDocument,
    setActiveFile,
    setActiveTabType,
    setActiveWorktree
  } as unknown as Base
  return renderHook(() => {
    const foundation = Object.assign({ ...base }, useTerminalEditorCloseFoundation(base))
    const queue = Object.assign(foundation, useTerminalEditorCloseQueue(foundation))
    return Object.assign(queue, useTerminalEditorCloseDialogActions(queue))
  })
}

/** An open file whose working document holds unsaved edits. */
function dirtyFile(id: string, worktreeId: string): FakeOpenFile {
  const documentId = `doc:${id}`
  store.workingDocuments[documentId] = {
    id: documentId,
    isDirty: true,
    revision: 1,
    target: { relativePath: `${id}.md` }
  }
  store.workingDocumentIdsByTab[id] = [documentId]
  return { id, worktreeId, isDirty: true, relativePath: `${id}.md` }
}

// Reveal unsaved floating notes in their own panel without taking over the main window’s workspace.
describe('unsaved-changes prompt for a closing file', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.activeWorktreeId = 'wt-main'
    store.workingDocuments = {}
    store.workingDocumentIdsByTab = {}
  })
  afterEach(() => cleanup())

  it('reveals a floating note in the floating panel without moving the main window', () => {
    store.openFiles = [dirtyFile('note', FLOATING_TERMINAL_WORKTREE_ID)]
    const { result } = mountCloseQueue()

    act(() => requestEditorTabClose('note'))

    expect(result.current.pendingEditorCloseState?.currentDocumentId).toBe('doc:note')
    expect(revealFloatingWorkspacePanel).toHaveBeenCalledOnce()
    expect(setActiveWorktree).not.toHaveBeenCalled()
    expect(setActiveTabType).toHaveBeenCalledWith('editor', FLOATING_TERMINAL_WORKTREE_ID)
  })

  it('still switches to a background worktree to show its file', () => {
    store.openFiles = [dirtyFile('readme', 'wt-other')]
    mountCloseQueue()

    act(() => requestEditorTabClose('readme'))

    expect(setActiveWorktree.mock.calls[0]?.[0]).toBe('wt-other')
    expect(revealFloatingWorkspacePanel).not.toHaveBeenCalled()
  })

  it('runs the close reaction once the file is discarded', async () => {
    store.openFiles = [dirtyFile('note', FLOATING_TERMINAL_WORKTREE_ID)]
    const onClosed = vi.fn()
    const { result } = mountCloseQueue()
    act(() => requestEditorTabClose('note', { onClosed }))

    await act(() => result.current.handleSaveDialogDiscard())

    expect(closeFile).toHaveBeenCalledWith('note')
    expect(onClosed).toHaveBeenCalledOnce()
  })

  // Why a later close of the same file: a cancelled reaction left behind would fire on it.
  it('drops the close reaction when the prompt is cancelled', async () => {
    vi.useFakeTimers()
    store.openFiles = [dirtyFile('note', FLOATING_TERMINAL_WORKTREE_ID)]
    const onClosed = vi.fn()
    const { result } = mountCloseQueue()
    act(() => requestEditorTabClose('note', { onClosed }))
    act(() => result.current.handleSaveDialogCancel())
    act(() => vi.runAllTimers())

    act(() => requestEditorTabClose('note'))
    await act(() => result.current.handleSaveDialogDiscard())

    expect(closeFile).toHaveBeenCalledWith('note')
    expect(onClosed).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
