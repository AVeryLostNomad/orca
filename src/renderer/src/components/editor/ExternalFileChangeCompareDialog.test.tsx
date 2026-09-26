// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkingDocument } from '@/store/slices/editor/working-document'

const readRuntimeFileContent = vi.hoisted(() => vi.fn())
const diffViewer = vi.hoisted(() =>
  vi.fn(
    ({
      originalContent,
      modifiedContent
    }: {
      originalContent: string
      modifiedContent: string
    }) => <div data-testid="comparison">{`${originalContent}::${modifiedContent}`}</div>
  )
)

vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ settings: { editorAutoSave: false } }) }
}))
vi.mock('@/runtime/runtime-file-client', () => ({ readRuntimeFileContent }))
vi.mock('@/runtime/runtime-rpc-client', () => ({
  settingsForRuntimeOwner: (settings: unknown) => settings
}))
vi.mock('@/lib/connection-context', () => ({ getConnectionIdForFile: () => 'ssh-1' }))
vi.mock('./DiffViewer', () => ({ default: diffViewer }))

import { ExternalFileChangeCompareDialog } from './ExternalFileChangeCompareDialog'

function makeDocument(): WorkingDocument {
  return {
    id: 'document-1' as WorkingDocument['id'],
    target: {
      owner: { executionHostId: 'local', runtimeEnvironmentId: null },
      filePath: '/repo/file.ts',
      relativePath: 'file.ts',
      worktreeId: 'wt-1',
      language: 'typescript',
      operationProvenance: {} as WorkingDocument['target']['operationProvenance']
    },
    content: 'draft',
    revision: 1,
    isDirty: true,
    loadState: 'ready',
    writable: true,
    alwaysAutoSave: false
  }
}

describe('ExternalFileChangeCompareDialog', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    readRuntimeFileContent.mockReset()
    diffViewer.mockClear()
    container = document.body.appendChild(document.createElement('div'))
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('reads the owner-routed disk snapshot and keeps it separate from current edits', async () => {
    readRuntimeFileContent.mockResolvedValue({ content: 'disk', isBinary: false })
    await act(async () => {
      root.render(
        <ExternalFileChangeCompareDialog
          document={makeDocument()}
          currentContent="draft"
          open
          onOpenChange={vi.fn()}
          onReload={vi.fn()}
          onKeepEdits={vi.fn()}
        />
      )
      await Promise.resolve()
    })
    expect(readRuntimeFileContent).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/repo/file.ts',
        relativePath: 'file.ts',
        worktreeId: 'wt-1',
        connectionId: 'ssh-1'
      })
    )
    await vi.waitFor(() => expect(document.body.textContent).toContain('disk::draft'))
    expect(diffViewer.mock.calls[0]?.[0]).toMatchObject({
      originalContent: 'disk',
      modifiedContent: 'draft'
    })
  })

  it('keeps reload and keep choices explicit after the read-only comparison', async () => {
    readRuntimeFileContent.mockResolvedValue({ content: 'disk', isBinary: false })
    const onReload = vi.fn()
    const onKeepEdits = vi.fn()
    const onOpenChange = vi.fn()
    await act(async () => {
      root.render(
        <ExternalFileChangeCompareDialog
          document={makeDocument()}
          currentContent="draft"
          open
          onOpenChange={onOpenChange}
          onReload={onReload}
          onKeepEdits={onKeepEdits}
        />
      )
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(document.body.textContent).toContain('Reload from Disk'))
    const reload = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent === 'Reload from Disk'
    )
    const keep = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent === 'Keep My Edits'
    )
    act(() => {
      reload?.click()
      keep?.click()
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onReload).toHaveBeenCalledOnce()
    expect(onKeepEdits).toHaveBeenCalledOnce()
  })
})
