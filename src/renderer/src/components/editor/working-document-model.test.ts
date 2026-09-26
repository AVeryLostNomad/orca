// @vitest-environment happy-dom
import * as monaco from 'monaco-editor'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { AppState } from '@/store/types'
import { createWorkingDocumentState } from '@/store/slices/editor/actions/working-document-actions'
import type {
  WorkingDocumentId,
  WorkingDocumentTarget
} from '@/store/slices/editor/working-document'
import { getDiskBaselineSignature } from './diff-content-signature'

const context = vi.hoisted(() => ({
  store: null as unknown as StoreApi<AppState>,
  saving: false,
  settled: undefined as ((id: WorkingDocumentId) => void) | undefined
}))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => context.store.getState(),
    subscribe: (listener: (state: AppState, previous: AppState) => void) =>
      context.store.subscribe(listener)
  }
}))
// The hoisted mock factory runs before static imports initialize.
vi.mock('@/lib/monaco-setup', async () => ({ monaco: await import('monaco-editor') }))
vi.mock('./editor-save-queue', () => ({
  isWorkingDocumentSavePending: () => context.saving,
  subscribeWorkingDocumentSaveSettled: (listener: (id: WorkingDocumentId) => void) => {
    context.settled = listener
    return () => {
      context.settled = undefined
    }
  }
}))
import { acquireWorkingDocumentModel, attachWorkingDocumentEditor } from './working-document-model'

function target(host: 'local' | 'ssh:other' = 'local'): WorkingDocumentTarget {
  return {
    owner: { executionHostId: host, runtimeEnvironmentId: null },
    filePath: '/repo/a.ts',
    worktreeId: 'wt',
    relativePath: 'a.ts',
    language: 'plaintext',
    operationProvenance: {} as WorkingDocumentTarget['operationProvenance']
  }
}

beforeEach(() => {
  context.saving = false
  context.store = createStore<AppState>()(
    (set, get) =>
      ({
        openFiles: [],
        unifiedTabsByWorktree: {},
        ...createWorkingDocumentState(set, get)
      }) as unknown as AppState
  )
})
afterEach(() => {
  const state = context.store.getState()
  for (const id of Object.keys(state.workingDocumentIdsByTab)) {
    state.releaseWorkingDocumentsForTab(id)
  }
  for (const document of Object.values(context.store.getState().workingDocuments)) {
    state.commitWorkingDocumentSave(
      document.id,
      document.content ?? '',
      getDiskBaselineSignature(document.content ?? '')
    )
    state.discardWorkingDocument(document.id)
  }
})

function admit(tab: string, owner = target()) {
  const state = context.store.getState()
  const id = state.retainWorkingDocument(tab, owner)
  state.acceptWorkingDocumentLoad(id, 0, 'const n = 1\n', getDiskBaselineSignature('const n = 1\n'))
  return id
}

describe('shared working document Monaco lifetime', () => {
  it('shares edits and undo across views and survives releasing one view', async () => {
    const id = admit('ordinary')
    admit('combined')
    const first = acquireWorkingDocumentModel(id)
    const detachFirst = attachWorkingDocumentEditor(id, 'ordinary-pane')
    const detachSecond = attachWorkingDocumentEditor(id, 'combined-row')
    const second = acquireWorkingDocumentModel(id)
    expect(second).toBe(first)
    first.pushStackElement()
    first.pushEditOperations([], [{ range: new monaco.Range(1, 11, 1, 12), text: '2' }], () => null)
    first.pushStackElement()
    expect(context.store.getState().workingDocuments[id].content).toBe('const n = 2\n')
    expect(context.store.getState().workingDocuments[id].revision).toBe(2)
    context.store.getState().releaseWorkingDocumentsForTab('ordinary')
    detachFirst()
    expect(second.isDisposed()).toBe(false)
    await second.undo()
    expect(context.store.getState().workingDocuments[id].content).toBe('const n = 1\n')
    expect(context.store.getState().workingDocuments[id].isDirty).toBe(false)
    context.store.getState().releaseWorkingDocumentsForTab('combined')
    expect(second.isDisposed()).toBe(false)
    detachSecond()
    expect(second.isDisposed()).toBe(true)
  })

  it('isolates equal paths on different hosts and retains a dirty orphan for recovery', () => {
    const local = admit('local')
    const remote = admit('remote', target('ssh:other'))
    const localModel = acquireWorkingDocumentModel(local)
    const remoteModel = acquireWorkingDocumentModel(remote)
    const detach = attachWorkingDocumentEditor(local, 'local-pane')
    localModel.pushEditOperations(
      [],
      [{ range: localModel.getFullModelRange(), text: '' }],
      () => null
    )
    expect(remoteModel.getValue()).toBe('const n = 1\n')
    context.store.getState().releaseWorkingDocumentsForTab('local')
    detach()
    expect(localModel.isDisposed()).toBe(false)
    expect(context.store.getState().workingDocuments[local]).toMatchObject({
      content: '',
      isDirty: true
    })
  })

  it('retains a released model until its in-flight save settles', () => {
    const id = admit('ordinary')
    const model = acquireWorkingDocumentModel(id)
    const detach = attachWorkingDocumentEditor(id, 'pane')
    context.saving = true
    context.store.getState().releaseWorkingDocumentsForTab('ordinary')
    detach()
    expect(model.isDisposed()).toBe(false)
    context.saving = false
    context.settled?.(id)
    expect(model.isDisposed()).toBe(true)
  })
})
