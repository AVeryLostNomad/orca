import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@/store/slices/editor'
import type { WorkingDocument } from '@/store/slices/editor/working-document'
import { getWorkingDocumentForFile } from '@/store/slices/editor/working-document-state'
import { makeWorktree } from '@/store/slices/worktrees-slice-test-fixtures'
import { getDiskBaselineSignature } from '../../../../shared/disk-baseline-signature'
import { createEditorSaveQueue, type EditorSaveQueue } from './editor-save-queue'
import { __clearSelfWriteRegistryForTests } from './editor-self-write-registry'
import { retainGuardedDocument } from './editor-save-guarded-disk-fixture'
import {
  createEditorStore,
  createFakeEditorDisk,
  stubEditorWindowWithDisk,
  type FakeEditorDisk
} from './editor-autosave-controller-test-fixture'

vi.mock('@/lib/connection-context', () => ({ getConnectionIdForFile: () => undefined }))

const PATH = '/repo/a.ts'
const DELAY_MS = 1000

function holdNextWrite(disk: FakeEditorDisk): () => void {
  let release = (): void => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  disk.fs.writeFile.mockImplementationOnce(
    async ({ filePath, content }: { filePath: string; content: string }) => {
      await gate
      disk.files.set(filePath, content)
      return { ok: true }
    }
  )
  return release
}

describe('editor save queue: one autosave timer per document across its views', () => {
  let disk: FakeEditorDisk
  let store: ReturnType<typeof createEditorStore>
  let queue: EditorSaveQueue
  let views: Record<string, OpenFile>

  const document = (viewId: string): WorkingDocument =>
    getWorkingDocumentForFile(store.getState(), views[viewId]!.id)!
  const type = (viewId: string, text: string): void => {
    store.getState().setWorkingDocumentContent(document(viewId).id, text)
    queue.syncAutoSave()
  }
  const writtenContents = (): string[] => disk.fs.writeFile.mock.calls.map(([args]) => args.content)

  beforeEach(() => {
    vi.useFakeTimers()
    disk = stubEditorWindowWithDisk(createFakeEditorDisk({ [PATH]: '' }))
    store = createEditorStore()
    store.setState({
      worktreesByRepo: {
        'repo-1': [
          makeWorktree({ id: 'wt-1', repoId: 'repo-1', path: '/repo', hostId: 'local' }),
          makeWorktree({ id: 'wt-2', repoId: 'repo-1', path: '/repo', hostId: 'local' })
        ]
      }
    })
    views = {}
    for (const [name, worktreeId] of [
      ['w1', 'wt-1'],
      ['w2', 'wt-2']
    ] as const) {
      store.getState().openFile({
        filePath: PATH,
        relativePath: 'a.ts',
        worktreeId,
        language: 'typescript',
        mode: 'edit'
      })
      views[name] = store.getState().openFiles.at(-1)!
      retainGuardedDocument(store, views[name].id)
    }
    expect(document('w1').id).toBe(document('w2').id)
    const loaded = document('w1')
    store
      .getState()
      .acceptWorkingDocumentLoad(loaded.id, loaded.revision, '', getDiskBaselineSignature(''))
    queue = createEditorSaveQueue(store)
  })

  afterEach(() => {
    queue.dispose()
    __clearSelfWriteRegistryForTests()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('writes typing from two workspaces once, with the latest text, and cleans both views', async () => {
    type('w1', 'abc')
    await vi.advanceTimersByTimeAsync(DELAY_MS / 2)
    type('w2', 'abcd')
    await vi.advanceTimersByTimeAsync(DELAY_MS)

    expect(writtenContents()).toEqual(['abcd'])
    expect(document('w1').isDirty).toBe(false)
    expect(document('w2').isDirty).toBe(false)
  })

  it('keeps the timer when the view that scheduled it closes', async () => {
    type('w1', 'abc')
    await vi.advanceTimersByTimeAsync(DELAY_MS / 2)
    store.getState().releaseWorkingDocumentsForTab(views.w1!.id)
    queue.syncAutoSave()
    await vi.advanceTimersByTimeAsync(DELAY_MS)

    expect(writtenContents()).toEqual(['abc'])
    expect(document('w2').isDirty).toBe(false)
  })

  it.each(['w1', 'w2'])(
    'schedules nothing for a conflicted document, whichever view (%s) typed',
    async (typist) => {
      store
        .getState()
        .setWorkingDocumentExternalState(document('w2').id, { externalMutation: 'changed' })
      expect(document('w1').externalMutation).toBe('changed')
      type(typist, 'abc')
      await vi.advanceTimersByTimeAsync(DELAY_MS * 2)

      expect(writtenContents()).toEqual([])
      expect(document('w1').isDirty).toBe(true)
    }
  )

  it("runs one view's Cmd+S queued behind another's in-flight write, in order", async () => {
    type('w1', 'a')
    const release = holdNextWrite(disk)
    const first = queue.queueSave(document('w1').id)
    await vi.advanceTimersByTimeAsync(0)
    type('w2', 'ab')
    const cmdS = queue.queueSave(document('w2').id)

    release()
    await Promise.all([first, cmdS])
    expect(writtenContents()).toEqual(['a', 'ab'])
    expect(document('w2').isDirty).toBe(false)
  })
})
