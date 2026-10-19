import { expect, it, vi } from 'vitest'
import type { AppState } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import { getWorkingDocumentForFile } from '@renderer/store/slices/editor/working-document-state'
import type { FileContent } from './editor-panel-content-types'
import { ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT } from './editor-autosave'
import { createEditorExternalChangeDocumentReset } from './editor-external-change-tab-reset'

type UnmountedExternalChangeTestContext = {
  createOpenFile: (overrides?: Partial<OpenFile>) => OpenFile
  dispatchExternalFileChange: (file: OpenFile, worktreePath: string) => void
  fileContents: () => Record<string, FileContent>
  getState: () => Record<string, unknown>
  readRuntimeFileContent: {
    mockResolvedValue: (value: FileContent) => void
    mock: { calls: unknown[][] }
  }
  renderProbe: (activeFile: OpenFile | null) => Promise<void>
  unmountProbe: () => void
}

export function registerUnmountedExternalChangeTests({
  createOpenFile,
  dispatchExternalFileChange,
  fileContents,
  getState,
  readRuntimeFileContent,
  renderProbe,
  unmountProbe
}: UnmountedExternalChangeTestContext): void {
  const attachDocumentReset = (): (() => void) => {
    const handleExternalFileChange = createEditorExternalChangeDocumentReset({
      store: { getState: getState as () => AppState } as never,
      clearAutoSaveTimer: vi.fn(),
      bumpSaveGeneration: vi.fn()
    })
    window.addEventListener(ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT, handleExternalFileChange)
    return () =>
      window.removeEventListener(ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT, handleExternalFileChange)
  }

  it('serves fresh disk content after an external change lands while the panel is unmounted', async () => {
    const detach = attachDocumentReset()
    try {
      const activeFile = createOpenFile()
      readRuntimeFileContent.mockResolvedValue({ content: 'v1', isBinary: false })
      await renderProbe(activeFile)
      await vi.waitFor(() => expect(fileContents()[activeFile.id]?.content).toBe('v1'))

      // A terminal tab becomes active: the panel unmounts but the working document stays retained.
      unmountProbe()
      readRuntimeFileContent.mockResolvedValue({ content: 'v2', isBinary: false })
      dispatchExternalFileChange(activeFile, '/repo')
      await vi.waitFor(() =>
        expect(getWorkingDocumentForFile(getState() as never, activeFile.id)?.content).toBe('v2')
      )
      expect(readRuntimeFileContent.mock.calls).toHaveLength(2)

      await renderProbe(activeFile)
      await vi.waitFor(() => expect(fileContents()[activeFile.id]?.content).toBe('v2'))
    } finally {
      detach()
    }
  })

  it('shares one disk read between the document reset and a visible panel reload', async () => {
    const detach = attachDocumentReset()
    try {
      const activeFile = createOpenFile()
      readRuntimeFileContent.mockResolvedValue({ content: 'v1', isBinary: false })
      await renderProbe(activeFile)
      await vi.waitFor(() => expect(fileContents()[activeFile.id]?.content).toBe('v1'))

      readRuntimeFileContent.mockResolvedValue({ content: 'v2', isBinary: false })
      dispatchExternalFileChange(activeFile, '/repo')
      await vi.waitFor(() => expect(fileContents()[activeFile.id]?.content).toBe('v2'))
      expect(readRuntimeFileContent.mock.calls).toHaveLength(2)
    } finally {
      detach()
    }
  })
}
