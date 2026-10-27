import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreApi } from 'zustand'
import type { AppState } from '@/store'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import { getDiskBaselineSignature } from '../../../../shared/disk-baseline-signature'
import { writeRuntimeTerminalArtifactFile } from '@/runtime/runtime-terminal-artifact-write'
import { createEditorStore } from './editor-autosave-controller-test-fixture'
import { makeWorktree } from '@/store/slices/worktrees-slice-test-fixtures'
import { createEditorSaveQueue } from './editor-save-queue'
import { retainGuardedDocument, stubGuardedDisk } from './editor-save-guarded-disk-fixture'
import { __clearSelfWriteRegistryForTests } from './editor-self-write-registry'
import { grantRestoredHostFile } from './restored-host-file-grant'

const HOST_ENVIRONMENT_ID = 'env-host'
const HOST_FILE = '/srv/shared/notes.md'
const HOST_WORKTREE = 'repo-1::/srv/repo'

vi.mock('@/lib/connection-context', () => ({ getConnectionIdForFile: () => null }))
vi.mock('@/runtime/runtime-terminal-artifact-write', () => ({
  writeRuntimeTerminalArtifactFile: vi.fn(async () => ({ ok: true }))
}))
vi.mock('./restored-host-file-grant', () => ({
  grantRestoredHostFile: vi.fn(async () => ({ grantId: 'grant-renewed', readOnly: false }))
}))
/** Loads the tab's working document clean, types into it, and returns the document id. */
function editLoaded(store: StoreApi<AppState>, fileId: string): WorkingDocumentId {
  const documentId = retainGuardedDocument(store, fileId)
  const loaded = store.getState().workingDocuments[documentId]!
  store
    .getState()
    .acceptWorkingDocumentLoad(
      documentId,
      loaded.revision,
      'disk',
      getDiskBaselineSignature('disk')
    )
  store.getState().setWorkingDocumentContent(documentId, 'edited')
  return documentId
}

async function save(store: StoreApi<AppState>, documentId: WorkingDocumentId): Promise<void> {
  const queue = createEditorSaveQueue(store)
  try {
    await queue.queueSave(documentId, 'user')
  } finally {
    queue.dispose()
  }
}

function withLocalWorktree(store: StoreApi<AppState>): StoreApi<AppState> {
  store.setState({
    worktreesByRepo: {
      'repo-1': [makeWorktree({ id: 'wt-1', repoId: 'repo-1', path: '/repo', hostId: 'local' })]
    }
  })
  return store
}

/** A workspace served by a paired runtime host; its tabs route writes to that environment. */
function withHostWorktree(store: StoreApi<AppState>): StoreApi<AppState> {
  const executionHostId = `runtime:${HOST_ENVIRONMENT_ID}` as const
  store.setState({
    activeWorktreeId: HOST_WORKTREE,
    repos: [
      {
        id: 'repo-1',
        path: '/srv/repo',
        displayName: 'repo',
        badgeColor: '#000',
        addedAt: 1,
        kind: 'git',
        executionHostId
      }
    ],
    worktreesByRepo: {
      'repo-1': [
        makeWorktree({
          id: HOST_WORKTREE,
          repoId: 'repo-1',
          path: '/srv/repo',
          hostId: executionHostId,
          runtimeOwnerEnvironmentId: HOST_ENVIRONMENT_ID
        })
      ]
    }
  })
  return store
}

function openHostFile(store: StoreApi<AppState>, terminalArtifactGrantId?: string): string {
  return store.getState().openFile({
    filePath: HOST_FILE,
    relativePath: HOST_FILE,
    worktreeId: HOST_WORKTREE,
    runtimeEnvironmentId: HOST_ENVIRONMENT_ID,
    terminalArtifactGrantId,
    language: 'markdown',
    mode: 'edit'
  })
}

describe('document save file access', () => {
  let writeFile: ReturnType<typeof stubGuardedDisk>['writeFile']

  beforeEach(() => {
    writeFile = stubGuardedDisk({
      '/tmp/outside.md': 'disk',
      '/Users/me/notes.txt': 'disk'
    }).writeFile
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(writeRuntimeTerminalArtifactFile).mockClear()
    vi.mocked(grantRestoredHostFile).mockClear()
    __clearSelfWriteRegistryForTests()
  })

  it('saves a local file opened from outside every workspace as a user-named file', async () => {
    const store = withLocalWorktree(createEditorStore())
    // Open-with/drop keeps the absolute path as relativePath when the file escapes the worktree.
    const fileId = store.getState().openFile({
      filePath: '/tmp/outside.md',
      relativePath: '/tmp/outside.md',
      worktreeId: 'wt-1',
      language: 'markdown',
      mode: 'edit',
      runtimeEnvironmentId: undefined
    })

    const documentId = editLoaded(store, fileId)

    await save(store, documentId)

    expect(writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/tmp/outside.md',
        content: 'edited',
        access: { kind: 'user-file' }
      })
    )
    expect(store.getState().workingDocuments[documentId]?.isDirty).toBe(false)
  })

  it('saves a floating-workspace file restored after restart', async () => {
    const store = createEditorStore()
    // Restored rows carry no grant and an unresolved runtime owner.
    const fileId = store.getState().openFile({
      filePath: '/Users/me/notes.txt',
      relativePath: 'notes.txt',
      worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
      language: 'plaintext',
      mode: 'edit'
    })
    const documentId = editLoaded(store, fileId)

    await save(store, documentId)

    expect(writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/Users/me/notes.txt',
        content: 'edited',
        access: { kind: 'user-file' }
      })
    )
    expect(store.getState().workingDocuments[documentId]?.isDirty).toBe(false)
  })

  it('saves a granted host file outside every workspace through its grant', async () => {
    const store = withHostWorktree(createEditorStore())
    const fileId = openHostFile(store, 'grant-open')

    await save(store, editLoaded(store, fileId))

    expect(writeFile).not.toHaveBeenCalled()
    expect(grantRestoredHostFile).not.toHaveBeenCalled()
    expect(writeRuntimeTerminalArtifactFile).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: 'environment', environmentId: HOST_ENVIRONMENT_ID },
        worktreeId: HOST_WORKTREE,
        absolutePath: HOST_FILE,
        grantId: 'grant-open',
        content: 'edited'
      })
    )
  })

  it('asks the host for a grant when a restored host file outside every workspace saves', async () => {
    const store = withHostWorktree(createEditorStore())
    // Restored after restart: grants are never persisted.
    const fileId = openHostFile(store)

    await save(store, editLoaded(store, fileId))

    expect(grantRestoredHostFile).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: HOST_ENVIRONMENT_ID },
      HOST_WORKTREE,
      HOST_FILE,
      undefined
    )
    expect(writeFile).not.toHaveBeenCalled()
    expect(writeRuntimeTerminalArtifactFile).toHaveBeenCalledWith(
      expect.objectContaining({ absolutePath: HOST_FILE, grantId: 'grant-renewed' })
    )
    expect(store.getState().openFiles.find((file) => file.id === fileId)).toMatchObject({
      terminalArtifactGrantId: 'grant-renewed'
    })
  })

  it('refuses a restored host file the host now opens read-only, keeping the edits', async () => {
    vi.mocked(grantRestoredHostFile).mockResolvedValueOnce({ grantId: 'g', readOnly: true })
    const store = withHostWorktree(createEditorStore())
    // Restored after restart: grants are never persisted.
    const fileId = openHostFile(store)
    const documentId = editLoaded(store, fileId)

    await expect(save(store, documentId)).rejects.toThrow(/read-only/)

    expect(writeRuntimeTerminalArtifactFile).not.toHaveBeenCalled()
    expect(store.getState().workingDocuments[documentId]?.isDirty).toBe(true)
  })
})
