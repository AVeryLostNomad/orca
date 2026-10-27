// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RuntimeFileMutationClient from '@/runtime/runtime-file-mutation-client'
import type * as EditorAutosave from '@/components/editor/editor-autosave'

const mocks = vi.hoisted(() => ({ renameRuntimePath: vi.fn() }))
vi.mock('@/runtime/runtime-file-mutation-client', async (importOriginal) => {
  const actual = await importOriginal<typeof RuntimeFileMutationClient>()
  return { ...actual, renameRuntimePath: mocks.renameRuntimePath }
})
vi.mock('@/runtime/runtime-rpc-client', async (importOriginal) =>
  (
    await import('@/runtime/layout-apply-test-transport.test-fixture')
  ).runtimeRpcClientWithLayoutApply(await importOriginal())
)
vi.mock('@/runtime/runtime-layout-client', async (importOriginal) =>
  (
    await import('@/runtime/layout-apply-test-transport.test-fixture')
  ).runtimeLayoutClientWithTestFrames(await importOriginal())
)
vi.mock('@/components/editor/editor-autosave', async (importOriginal) => {
  const actual = await importOriginal<typeof EditorAutosave>()
  return { ...actual, quiesceDocumentSave: vi.fn().mockResolvedValue(undefined) }
})

import { useAppStore } from '@/store'
import { executeOpenEditorPathMove } from './execute-open-editor-path-move'
import { __activeEditorPathMoveCountForTests } from '@/components/editor/editor-path-move-inflight'
import { getDiskBaselineSignature } from '../../../shared/disk-baseline-signature'
import { buildEditorExternalWatchEventHandler as createExternalWatchEventHandler } from '@/hooks/editor-external-watch-event-reconciliation'
import type {
  WorkingDocumentId,
  WorkingDocumentTarget
} from '@/store/slices/editor/working-document'
import {
  drawTabsFromMain,
  type TabsDrawnFromMain
} from '@/store/slices/tabs-drawn-from-main.test-fixture'

let main: TabsDrawnFromMain

const CONTEXT = {
  target: { kind: 'local' as const },
  worktreeId: 'wt-1',
  worktreePath: '/repo',
  connectionId: undefined
}

function openDirtyTab(): string {
  const state = useAppStore.getState()
  state.openFile(
    {
      filePath: '/repo/a.md',
      relativePath: 'a.md',
      worktreeId: 'wt-1',
      runtimeEnvironmentId: null,
      language: 'markdown',
      mode: 'edit'
    },
    { suppressActiveRuntimeFallback: true }
  )
  const file = useAppStore.getState().openFiles[0]!
  const id = file.id
  const operationProvenance = {
    generation: {
      route: { executionHostId: 'local', runtimeEnvironmentId: null },
      runtimeConnectionGeneration: null,
      runtimePairingRevision: undefined,
      runtimeSshGeneration: null,
      nestedSshGeneration: null,
      directSshGeneration: null
    },
    ownershipProjection: 'explicit'
  } as never
  useAppStore.setState({
    openFiles: useAppStore
      .getState()
      .openFiles.map((candidate) =>
        candidate.id === id ? { ...candidate, operationProvenance } : candidate
      )
  })
  const target: WorkingDocumentTarget = {
    owner: { executionHostId: 'local', runtimeEnvironmentId: null },
    filePath: file.filePath,
    relativePath: file.relativePath,
    worktreeId: file.worktreeId,
    language: file.language,
    operationProvenance
  }
  const documentId = state.retainWorkingDocument(id, target)
  state.acceptWorkingDocumentLoad(documentId, 0, 'saved content', 'sig-a')
  state.setWorkingDocumentContent(documentId, 'unsaved work')
  return id
}

function documentIdForTab(tabId: string): WorkingDocumentId {
  const state = useAppStore.getState()
  const documentId = state.workingDocumentIdsByTab[tabId]?.[0]
  if (!documentId) {
    throw new Error(`Missing document for ${tabId}`)
  }
  return documentId
}
function documentForTab(tabId: string) {
  const state = useAppStore.getState()
  const documentId = state.workingDocumentIdsByTab[tabId]?.[0]
  return documentId ? state.workingDocuments[documentId] : undefined
}

function setDocumentDiskSignature(tabId: string, diskContent: string): void {
  const state = useAppStore.getState()
  const documentId = documentIdForTab(tabId)
  const document = state.workingDocuments[documentId]!
  state.commitWorkingDocumentSave(documentId, diskContent, getDiskBaselineSignature(diskContent))
  state.setWorkingDocumentContent(documentId, document.content!)
}

describe('executeOpenEditorPathMove', () => {
  beforeEach(async () => {
    useAppStore.setState(useAppStore.getInitialState(), true)
    mocks.renameRuntimePath.mockReset().mockResolvedValue(undefined)
    main = await drawTabsFromMain(useAppStore)
  })

  afterEach(() => {
    main.close()
    vi.unstubAllGlobals()
  })

  it('renames on disk, retargets the session in place, and installs the verify gate', async () => {
    openDirtyTab()

    await executeOpenEditorPathMove({
      context: CONTEXT,
      fromPath: '/repo/a.md',
      toPath: '/repo/sub/a.md',
      worktreeId: 'wt-1',
      worktreePath: '/repo'
    })

    expect(mocks.renameRuntimePath).toHaveBeenCalledWith(
      CONTEXT,
      '/repo/a.md',
      '/repo/sub/a.md',
      undefined
    )
    const moved = useAppStore.getState().openFiles[0]!
    expect(moved.filePath).toBe('/repo/sub/a.md')
    expect(moved.isDirty).toBe(true)
    const movedDocument = documentForTab(moved.id)
    expect(movedDocument?.lastKnownDiskSignature).toBe('sig-a')
    expect(movedDocument?.content).toBe('unsaved work')
    // Dirty destination gets the move-echo verification gate on its document.
    expect(movedDocument?.pendingLiveDiskVerification).toBe(true)
    expect(movedDocument?.pendingSelfMoveEcho?.targetPath).toBe('/repo/sub/a.md')
    // The in-flight transaction is settled (no leak).
    expect(__activeEditorPathMoveCountForTests()).toBe(0)
  })

  it('never retargets the same path open from a same-id workspace on a server', async () => {
    const localId = openDirtyTab()
    const state = useAppStore.getState()
    state.openFile({
      filePath: '/repo/a.md',
      relativePath: 'a.md',
      worktreeId: 'wt-1',
      runtimeEnvironmentId: 'env-server',
      language: 'markdown',
      mode: 'edit'
    })
    const remote = useAppStore
      .getState()
      .openFiles.find((file) => file.runtimeEnvironmentId === 'env-server')!
    const remoteDocumentId = state.retainWorkingDocument(remote.id, {
      owner: { executionHostId: 'runtime:env-server', runtimeEnvironmentId: 'env-server' },
      filePath: remote.filePath,
      relativePath: remote.relativePath,
      worktreeId: remote.worktreeId,
      language: remote.language,
      operationProvenance: {
        generation: {
          route: { executionHostId: 'runtime:env-server', runtimeEnvironmentId: 'env-server' },
          runtimeConnectionGeneration: null,
          runtimePairingRevision: undefined,
          runtimeSshGeneration: null,
          nestedSshGeneration: null,
          directSshGeneration: null
        },
        ownershipProjection: 'explicit'
      } as never
    })
    state.acceptWorkingDocumentLoad(remoteDocumentId, 0, 'server disk', 'sig-server')
    state.setWorkingDocumentContent(remoteDocumentId, 'server draft')

    await executeOpenEditorPathMove({
      context: { ...CONTEXT, expectedExecutionHostId: 'local' },
      fromPath: '/repo/a.md',
      toPath: '/repo/b.md',
      worktreeId: 'wt-1',
      worktreePath: '/repo'
    })

    const files = useAppStore.getState().openFiles
    expect(files.find((file) => file.runtimeEnvironmentId !== 'env-server')!.filePath).toBe(
      '/repo/b.md'
    )
    expect(files.find((file) => file.id === remote.id)).toMatchObject({
      filePath: '/repo/a.md',
      isDirty: true
    })
    expect(useAppStore.getState().workingDocuments[remoteDocumentId]).toMatchObject({
      content: 'server draft',
      target: expect.objectContaining({ filePath: '/repo/a.md' })
    })
    const movedLocal = files.find((file) => file.runtimeEnvironmentId !== 'env-server')!
    expect(movedLocal.id).not.toBe(localId)
    expect(documentForTab(movedLocal.id)?.target.filePath).toBe('/repo/b.md')
  })

  it('still moves its own tab when the workspace host focus changes while the rename runs', async () => {
    openDirtyTab()
    mocks.renameRuntimePath.mockImplementation(async () => {
      useAppStore.setState({
        activeWorktreeId: 'wt-1',
        activeWorkspaceExecutionHostId: 'runtime:env-other'
      })
    })

    await executeOpenEditorPathMove({
      context: { ...CONTEXT, expectedExecutionHostId: 'local' },
      fromPath: '/repo/a.md',
      toPath: '/repo/b.md',
      worktreeId: 'wt-1',
      worktreePath: '/repo'
    })

    expect(useAppStore.getState().openFiles[0]!.filePath).toBe('/repo/b.md')
  })

  it('declares the moved file as the document for a document-scoped rename', async () => {
    openDirtyTab()

    await executeOpenEditorPathMove({
      context: CONTEXT,
      fromPath: '/repo/a.md',
      toPath: '/repo/b.md',
      worktreeId: 'wt-1',
      worktreePath: '/repo',
      documentScoped: true
    })

    expect(mocks.renameRuntimePath).toHaveBeenCalledWith(CONTEXT, '/repo/a.md', '/repo/b.md', {
      kind: 'document-folder',
      documentPath: '/repo/a.md'
    })
  })

  it('resolves the verify gate proactively when no destination watcher event arrives', async () => {
    const DISK_CONTENT = 'the file as it exists on disk\n'
    const id = openDirtyTab()
    setDocumentDiskSignature(id, DISK_CONTENT)
    vi.stubGlobal('window', {
      api: {
        fs: { readFile: vi.fn().mockResolvedValue({ isBinary: false, content: DISK_CONTENT }) }
      }
    })

    await executeOpenEditorPathMove({
      context: CONTEXT,
      fromPath: '/repo/a.md',
      toPath: '/repo/sub/a.md',
      worktreeId: 'wt-1',
      worktreePath: '/repo'
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    const moved = useAppStore.getState().openFiles[0]!
    const movedDocument = documentForTab(moved.id)
    // Disk matched the carried baseline: gate released, no false conflict banner.
    expect(movedDocument?.pendingLiveDiskVerification).toBeFalsy()
    expect(movedDocument?.externalMutation).toBeUndefined()
    expect(moved.isDirty).toBe(true)
    // Safety-net verify LEAVES the provenance so a destination watcher event
    // arriving after this read is still recognized as the move's own echo.
    expect(movedDocument?.pendingSelfMoveEcho?.targetPath).toBe('/repo/sub/a.md')
  })

  it('does not raise a false banner when the destination watcher event lands after the move', async () => {
    // FSEvents/SSH events may follow fast verification; consuming provenance early would mark our own rename as an external edit.
    const DISK_CONTENT = 'the file as it exists on disk\n'
    const id = openDirtyTab()
    setDocumentDiskSignature(id, DISK_CONTENT)
    vi.stubGlobal('window', {
      api: {
        fs: { readFile: vi.fn().mockResolvedValue({ isBinary: false, content: DISK_CONTENT }) }
      }
    })

    await executeOpenEditorPathMove({
      context: CONTEXT,
      fromPath: '/repo/a.md',
      toPath: '/repo/sub/a.md',
      worktreeId: 'wt-1',
      worktreePath: '/repo'
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    const { handleFsChanged, dispose } = createExternalWatchEventHandler((worktreePath) =>
      worktreePath === '/repo'
        ? {
            worktreeId: 'wt-1',
            worktreePath: '/repo',
            connectionId: undefined,
            runtimeEnvironmentId: null
          }
        : undefined
    )
    handleFsChanged({
      worktreePath: '/repo',
      events: [{ kind: 'update', absolutePath: '/repo/sub/a.md' }]
    })
    await new Promise((resolve) => setTimeout(resolve, 120))

    const moved = useAppStore.getState().openFiles[0]!
    expect(documentForTab(moved.id)?.externalMutation).toBeUndefined()
    expect(moved.isDirty).toBe(true)
    dispose()
  })

  it('undoes the on-disk rename when the editor rekey collides', async () => {
    openDirtyTab()
    useAppStore.getState().openFile(
      {
        filePath: '/repo/sub/a.md',
        relativePath: 'sub/a.md',
        worktreeId: 'wt-1',
        runtimeEnvironmentId: null,
        language: 'markdown',
        mode: 'edit'
      },
      { suppressActiveRuntimeFallback: true }
    )
    const before = useAppStore.getState().openFiles.map((f) => f.id)

    await expect(
      executeOpenEditorPathMove({
        context: CONTEXT,
        fromPath: '/repo/a.md',
        toPath: '/repo/sub/a.md',
        worktreeId: 'wt-1',
        worktreePath: '/repo'
      })
    ).rejects.toThrow(/retarget/)

    expect(mocks.renameRuntimePath).toHaveBeenCalledWith(
      CONTEXT,
      '/repo/a.md',
      '/repo/sub/a.md',
      undefined
    )
    expect(mocks.renameRuntimePath).toHaveBeenCalledWith(
      CONTEXT,
      '/repo/sub/a.md',
      '/repo/a.md',
      undefined
    )
    expect(useAppStore.getState().openFiles.map((f) => f.id)).toEqual(before)
  })

  it('undoes a document-scoped rename with the renamed file as the document', async () => {
    openDirtyTab()
    useAppStore.getState().openFile(
      {
        filePath: '/repo/b.md',
        relativePath: 'b.md',
        worktreeId: 'wt-1',
        runtimeEnvironmentId: null,
        language: 'markdown',
        mode: 'edit'
      },
      { suppressActiveRuntimeFallback: true }
    )

    await expect(
      executeOpenEditorPathMove({
        context: CONTEXT,
        fromPath: '/repo/a.md',
        toPath: '/repo/b.md',
        worktreeId: 'wt-1',
        worktreePath: '/repo',
        documentScoped: true
      })
    ).rejects.toThrow(/retarget/)

    expect(mocks.renameRuntimePath).toHaveBeenLastCalledWith(CONTEXT, '/repo/b.md', '/repo/a.md', {
      kind: 'document-folder',
      documentPath: '/repo/b.md'
    })
  })

  it('leaves the store untouched and settles the transaction when the rename fails', async () => {
    openDirtyTab()
    const before = useAppStore.getState().openFiles.map((f) => ({ ...f }))
    mocks.renameRuntimePath.mockRejectedValue(new Error('EACCES'))

    await expect(
      executeOpenEditorPathMove({
        context: CONTEXT,
        fromPath: '/repo/a.md',
        toPath: '/repo/sub/a.md',
        worktreeId: 'wt-1',
        worktreePath: '/repo'
      })
    ).rejects.toThrow('EACCES')

    expect(useAppStore.getState().openFiles).toEqual(before)
    expect(__activeEditorPathMoveCountForTests()).toBe(0)
  })
})
