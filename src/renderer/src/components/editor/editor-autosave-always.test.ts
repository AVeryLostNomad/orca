// Why: workspace-notes files must autosave even when the global editorAutoSave
// setting is off — the per-file alwaysAutoSave override in the save queue.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachEditorAutosaveController } from './editor-autosave-controller'
import { __clearSelfWriteRegistryForTests } from './editor-self-write-registry'
import { createEditorStore, stubEditorWindow } from './editor-autosave-controller-test-fixture'

const mocks = vi.hoisted(() => ({
  getConnectionIdForFile: vi.fn()
}))

vi.mock('@/lib/connection-context', () => ({
  getConnectionIdForFile: mocks.getConnectionIdForFile
}))

describe('alwaysAutoSave override', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.getConnectionIdForFile.mockReset()
    mocks.getConnectionIdForFile.mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    __clearSelfWriteRegistryForTests()
  })

  function setupStoreWithGlobalAutosaveOff(): ReturnType<typeof createEditorStore> {
    const store = createEditorStore()
    store.setState({
      settings: { editorAutoSave: false, editorAutoSaveDelayMs: 1000 }
    } as never)
    return store
  }

  it('autosaves an alwaysAutoSave file with the global setting off', async () => {
    const writeFile = stubEditorWindow()
    const store = setupStoreWithGlobalAutosaveOff()
    store.getState().openFile({
      filePath: '/notes/notes.md',
      relativePath: 'notes.md',
      worktreeId: 'wt-1',
      language: 'markdown',
      mode: 'edit',
      alwaysAutoSave: true
    })

    const cleanup = attachEditorAutosaveController(store)
    try {
      store.getState().setEditorDraft('/notes/notes.md', '# Notes\n- edited')
      store.getState().markFileDirty('/notes/notes.md', true)
      await vi.advanceTimersByTimeAsync(1100)

      expect(writeFile).toHaveBeenCalledTimes(1)
      expect(writeFile.mock.calls[0][0]).toMatchObject({
        filePath: '/notes/notes.md',
        content: '# Notes\n- edited'
      })
      expect(store.getState().openFiles[0]?.isDirty).toBe(false)
    } finally {
      cleanup()
    }
  })

  it('does not autosave ordinary files with the global setting off', async () => {
    const writeFile = stubEditorWindow()
    const store = setupStoreWithGlobalAutosaveOff()
    store.getState().openFile({
      filePath: '/repo/file.ts',
      relativePath: 'file.ts',
      worktreeId: 'wt-1',
      language: 'typescript',
      mode: 'edit'
    })

    const cleanup = attachEditorAutosaveController(store)
    try {
      store.getState().setEditorDraft('/repo/file.ts', 'edited')
      store.getState().markFileDirty('/repo/file.ts', true)
      await vi.advanceTimersByTimeAsync(1100)

      expect(writeFile).not.toHaveBeenCalled()
      expect(store.getState().openFiles[0]?.isDirty).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('keeps the changed-on-disk suspension for alwaysAutoSave files', async () => {
    const writeFile = stubEditorWindow()
    const store = setupStoreWithGlobalAutosaveOff()
    store.getState().openFile({
      filePath: '/notes/notes.md',
      relativePath: 'notes.md',
      worktreeId: 'wt-1',
      language: 'markdown',
      mode: 'edit',
      alwaysAutoSave: true
    })
    store.getState().setExternalMutation('/notes/notes.md', 'changed')

    const cleanup = attachEditorAutosaveController(store)
    try {
      store.getState().setEditorDraft('/notes/notes.md', 'conflicting edit')
      store.getState().markFileDirty('/notes/notes.md', true)
      await vi.advanceTimersByTimeAsync(1100)

      expect(writeFile).not.toHaveBeenCalled()
    } finally {
      cleanup()
    }
  })
})
