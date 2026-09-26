// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import {
  buildWorkingDocumentTarget,
  type WorkingDocumentId
} from '@/store/slices/editor/working-document'
import { migrateRestoredEditorFileOwner } from './migrate-restored-editor-file-owner'

const SOURCE = 'repo-a::/repo-a'
const TARGET = 'repo-b::/repo-b'
const FILE_PATH = '/repo-b/file.md'

function seed(filePath = FILE_PATH): { tabId: string; documentId: WorkingDocumentId } {
  useAppStore.setState(useAppStore.getInitialState(), true)
  useAppStore.setState({
    activeWorktreeId: SOURCE,
    repos: [
      { id: 'repo-a', path: '/repo-a', kind: 'git', executionHostId: 'local' },
      { id: 'repo-b', path: '/repo-b', kind: 'git', executionHostId: 'local' }
    ],
    worktreesByRepo: {
      'repo-a': [{ id: SOURCE, repoId: 'repo-a', path: '/repo-a', hostId: 'local', branch: '' }],
      'repo-b': [{ id: TARGET, repoId: 'repo-b', path: '/repo-b', hostId: 'local', branch: '' }]
    },
    detectedWorktreesByRepo: {},
    runtimeEnvironments: [],
    runtimeEnvironmentCatalogHydrated: true,
    removedRuntimeEnvironmentIds: new Set(),
    sshConnectionStates: new Map(),
    sshStateByEnvironment: new Map()
  } as unknown as Partial<AppState>)
  const tabId = useAppStore.getState().openFile(
    {
      filePath,
      relativePath: filePath,
      worktreeId: SOURCE,
      runtimeEnvironmentId: null,
      language: 'markdown',
      mode: 'edit'
    },
    { suppressActiveRuntimeFallback: true }
  )
  const state = useAppStore.getState()
  const file = state.openFiles.find((candidate) => candidate.id === tabId)!
  const documentId = state.retainWorkingDocument(tabId, buildWorkingDocumentTarget(state, file))
  state.acceptWorkingDocumentLoad(documentId, 0, 'disk content', 'disk-signature')
  state.setWorkingDocumentContent(documentId, 'unsaved content')
  return { tabId, documentId }
}

describe('restored editor owner migration', () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true)
  })

  it('quiesces and reparents the canonical document without dropping its draft', async () => {
    const { tabId } = seed()

    const result = await migrateRestoredEditorFileOwner(
      tabId,
      { worktreeId: TARGET, relativePath: 'file.md', executionHostId: 'local' },
      null
    )

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const document = Object.values(useAppStore.getState().workingDocuments).find(
      (candidate) => candidate.target.worktreeId === TARGET
    )
    expect(document).toMatchObject({
      content: 'unsaved content',
      isDirty: true,
      pendingOwnerMigration: undefined,
      target: {
        worktreeId: TARGET,
        relativePath: 'file.md',
        owner: { executionHostId: 'local', runtimeEnvironmentId: null }
      }
    })
    expect(useAppStore.getState().workingDocumentIdsByTab[result.fileId]).toEqual([document!.id])
    expect(useAppStore.getState().workingDocumentIdsByTab[tabId]).toBeUndefined()
  })

  it('fails closed when the canonical document is already migrating', async () => {
    const { tabId, documentId } = seed()
    useAppStore
      .getState()
      .setWorkingDocumentExternalState(documentId, { pendingOwnerMigration: true })

    await expect(
      migrateRestoredEditorFileOwner(
        tabId,
        { worktreeId: TARGET, relativePath: 'file.md', executionHostId: 'local' },
        null
      )
    ).resolves.toEqual({ ok: false, reason: 'stale' })
  })

  it('does not create a document when the tab has no retained document', async () => {
    useAppStore.setState(useAppStore.getInitialState(), true)
    const tabId = useAppStore.getState().openFile(
      {
        filePath: FILE_PATH,
        relativePath: FILE_PATH,
        worktreeId: SOURCE,
        runtimeEnvironmentId: null,
        language: 'markdown',
        mode: 'edit'
      },
      { suppressActiveRuntimeFallback: true }
    )

    await expect(
      migrateRestoredEditorFileOwner(
        tabId,
        { worktreeId: TARGET, relativePath: 'file.md', executionHostId: 'local' },
        null
      )
    ).resolves.toEqual({ ok: false, reason: 'stale' })
  })
})
