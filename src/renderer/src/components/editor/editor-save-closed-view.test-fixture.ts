import { vi } from 'vitest'
import { makeWorktree } from '@/store/slices/worktrees-slice-test-fixtures'
import type { WorkingDocument } from '@/store/slices/editor/working-document'
import { getWorkingDocumentForFile } from '@/store/slices/editor/working-document-state'
import { getDiskBaselineSignature } from '../../../../shared/disk-baseline-signature'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { createEditorSaveQueue, type EditorSaveQueue } from './editor-save-queue'
import { __clearSelfWriteRegistryForTests } from './editor-self-write-registry'
import { retainGuardedDocument } from './editor-save-guarded-disk-fixture'
import {
  createEditorStore,
  createFakeEditorDisk,
  stubEditorWindowWithDisk,
  type FakeEditorDisk
} from './editor-autosave-controller-test-fixture'

export const CLOSED_VIEW_PATH = '/repo/a.md'

export function closedViewWorktree(
  id: string,
  hostId: ExecutionHostId = 'local'
): ReturnType<typeof makeWorktree> {
  return makeWorktree({ id, repoId: 'repo-1', path: '/repo', hostId })
}

export type ClosedViewHarness = {
  disk: FakeEditorDisk
  store: ReturnType<typeof createEditorStore>
  queue: EditorSaveQueue
  /** The working document a view shows; it outlives a closed view while another retains it. */
  document: (view: string) => WorkingDocument
  type: (view: string, text: string) => void
  /** The next write waits for `release`; `refuse` makes it a changed-on-disk refusal. */
  holdNextWrite: (refuse?: boolean) => void
  release: () => void
  closeView: (view: string) => void
  dispose: () => void
}

/** Two workspace views (A, B) of one file share a working document; only explicit saves write. */
export function createClosedViewHarness(): ClosedViewHarness {
  vi.useFakeTimers()
  const disk = stubEditorWindowWithDisk(createFakeEditorDisk({ [CLOSED_VIEW_PATH]: 'disk' }))
  const store = createEditorStore()
  store.setState({
    worktreesByRepo: { 'repo-1': [closedViewWorktree('wt-1'), closedViewWorktree('wt-2')] }
  })
  const viewIds: Record<string, string> = {}
  for (const [view, worktreeId] of [
    ['A', 'wt-1'],
    ['B', 'wt-2']
  ] as const) {
    store.getState().openFile({
      filePath: CLOSED_VIEW_PATH,
      relativePath: 'a.md',
      worktreeId,
      language: 'markdown',
      mode: 'edit'
    })
    viewIds[view] = store.getState().openFiles.at(-1)!.id
    retainGuardedDocument(store, viewIds[view])
  }
  const document = (view: string): WorkingDocument =>
    getWorkingDocumentForFile(store.getState(), viewIds[view]!)!
  const loaded = document('A')
  store
    .getState()
    .acceptWorkingDocumentLoad(loaded.id, loaded.revision, 'disk', getDiskBaselineSignature('disk'))
  const queue = createEditorSaveQueue(store)
  let releaseWrite = (): void => {}
  return {
    disk,
    store,
    queue,
    document,
    type: (view, text) => store.getState().setWorkingDocumentContent(document(view).id, text),
    holdNextWrite: (refuse = false) => {
      const gate = new Promise<void>((resolve) => {
        releaseWrite = resolve
      })
      disk.fs.writeFile.mockImplementationOnce(
        async ({ filePath, content }: { filePath: string; content: string }) => {
          await gate
          if (refuse) {
            return { ok: false, diskConflict: 'changed' }
          }
          disk.files.set(filePath, content)
          return { ok: true }
        }
      )
    },
    release: () => releaseWrite(),
    closeView: (view) => {
      const id = viewIds[view]!
      store.getState().releaseWorkingDocumentsForTab(id)
      store.setState({
        openFiles: store.getState().openFiles.filter((openFile) => openFile.id !== id)
      })
    },
    dispose: () => {
      queue.dispose()
      __clearSelfWriteRegistryForTests()
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  }
}
