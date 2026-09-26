// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import { useTerminalEditorCloseQueue } from './use-terminal-editor-close-queue'

const storeState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))

vi.mock('../store', () => ({
  useAppStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(storeState.current),
    { getState: () => storeState.current }
  )
}))
vi.mock('./terminal-workspace-model', () => ({ isPinnedActiveEditorTab: () => false }))

const DOCUMENT_ID = 'document-a' as WorkingDocumentId

function closeController() {
  return {
    activeWorktreeId: 'wt-a',
    closeFile: vi.fn(),
    pendingEditorCloseState: null,
    proceedToNativeWindowClose: vi.fn(),
    setActiveFile: vi.fn(),
    setActiveTabType: vi.fn(),
    setActiveWorktree: vi.fn(),
    setPendingEditorCloseState: vi.fn(),
    windowCloseAfterDirtyRef: { current: null }
  } as unknown as Parameters<typeof useTerminalEditorCloseQueue>[0]
}

function setDocumentState(tabIdsByDocument: Record<string, readonly WorkingDocumentId[]>) {
  storeState.current = {
    activeWorktreeId: 'wt-a',
    openFiles: Object.keys(tabIdsByDocument).map((id) => ({ id, worktreeId: 'wt-a' })),
    workingDocuments: { [DOCUMENT_ID]: { id: DOCUMENT_ID, isDirty: true } },
    workingDocumentIdsByTab: tabIdsByDocument
  }
}

beforeEach(() => {
  storeState.current = {}
})

describe('useTerminalEditorCloseQueue', () => {
  it('prompts once for a dirty document losing all requested views', () => {
    setDocumentState({ 'tab-a': [DOCUMENT_ID], 'tab-b': [DOCUMENT_ID] })
    const controller = closeController()
    const { result } = renderHook(() => useTerminalEditorCloseQueue(controller))

    act(() => result.current.queueEditorCloseRequests(['tab-a', 'tab-b']))

    expect(controller.closeFile).not.toHaveBeenCalled()
    expect(controller.setPendingEditorCloseState).toHaveBeenLastCalledWith({
      tabIds: ['tab-a', 'tab-b'],
      pendingDocumentIds: [DOCUMENT_ID],
      currentDocumentId: DOCUMENT_ID
    })
  })

  it('immediately releases one dirty shared view without prompting', () => {
    setDocumentState({ 'tab-a': [DOCUMENT_ID], 'tab-b': [DOCUMENT_ID] })
    const controller = closeController()
    const { result } = renderHook(() => useTerminalEditorCloseQueue(controller))

    act(() => result.current.queueEditorCloseRequests(['tab-a']))

    expect(controller.closeFile).toHaveBeenCalledWith('tab-a')
    expect(controller.setPendingEditorCloseState).toHaveBeenLastCalledWith(null)
  })
})
