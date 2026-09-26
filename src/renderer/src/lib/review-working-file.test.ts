import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { openReviewWorkingFile } from './review-working-file'

const mocks = vi.hoisted(() => ({ stat: vi.fn(), error: vi.fn() }))
vi.mock('@/runtime/runtime-file-metadata-client', () => ({ statRuntimePath: mocks.stat }))
vi.mock('sonner', () => ({ toast: { error: mocks.error } }))

const worktreeId = 'repo::/repo'
const target = { worktreeId, worktreePath: '/repo', relativePath: 'current.ts' }

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  useAppStore.setState({
    activeWorktreeId: worktreeId,
    settings: { activeRuntimeEnvironmentId: 'unrelated-host' } as never,
    worktreesByRepo: {
      repo: [
        {
          id: worktreeId,
          repoId: 'repo',
          path: '/repo',
          hostId: 'local',
          runtimeOwnerEnvironmentId: null
        } as never
      ]
    },
    runtimeEnvironmentCatalogHydrated: true
  })
  mocks.stat.mockReset().mockResolvedValue({ size: 0, isDirectory: false, mtime: 1 })
  mocks.error.mockClear()
})

describe('review working-file navigation', () => {
  it('reuses a dirty current document, exits Changes mode, and focuses a permanent editor', async () => {
    const state = useAppStore.getState()
    const fileId = state.openFile(
      {
        filePath: '/repo/current.ts',
        relativePath: 'current.ts',
        worktreeId,
        language: 'typescript',
        mode: 'edit'
      },
      { preview: true }
    )
    const document = Object.values(useAppStore.getState().workingDocuments)[0]!
    state.acceptWorkingDocumentLoad(document.id, 0, 'saved', 'disk-signature')
    state.setWorkingDocumentContent(document.id, 'unsaved')
    state.setEditorViewMode(fileId, 'changes')
    state.openDiff(worktreeId, '/repo/current.ts', 'current.ts', 'typescript', false)

    expect(await openReviewWorkingFile(target)).toBe(fileId)
    const opened = useAppStore.getState()
    expect(opened.activeFileId).toBe(fileId)
    expect(opened.editorViewMode[fileId]).toBe('edit')
    expect(opened.openFiles.find((file) => file.id === fileId)).toMatchObject({
      mode: 'edit',
      isDirty: true
    })
    expect(opened.workingDocuments[document.id]).toMatchObject({
      content: 'unsaved',
      isDirty: true,
      target: { owner: { executionHostId: 'local', runtimeEnvironmentId: null } }
    })
    expect(opened.pendingEditorFocusRequest?.fileId).toBe(fileId)
    expect(opened.openFiles.find((file) => file.id === fileId)?.isPreview).not.toBe(true)
  })

  it('leaves an absent current file in its review without creating an editable document', async () => {
    useAppStore
      .getState()
      .openDiff(worktreeId, '/repo/current.ts', 'current.ts', 'typescript', true)
    const reviewId = useAppStore.getState().activeFileId
    for (const error of [
      Object.assign(new Error('missing'), { code: 'ENOENT' }),
      new Error(
        "Error invoking remote method 'fs:stat': Error: ENOTDIR: not a directory, stat '/repo/current.ts'"
      )
    ]) {
      mocks.stat.mockRejectedValueOnce(error)
      expect(await openReviewWorkingFile(target)).toBeNull()
      expect(useAppStore.getState().activeFileId).toBe(reviewId)
      expect(useAppStore.getState().openFiles.every((file) => file.mode === 'diff')).toBe(true)
      expect(Object.values(useAppStore.getState().workingDocuments)).toEqual([])
    }
  })

  it('does not misclassify permission or host failures as a deleted file', async () => {
    for (const message of [
      "EACCES: permission denied, stat '/repo/: ENOENT: /current.ts'",
      'SSH host not found'
    ]) {
      mocks.stat.mockRejectedValueOnce(new Error(message))
      const fileId = await openReviewWorkingFile(target)
      expect(useAppStore.getState().openFiles.find((file) => file.id === fileId)?.mode).toBe('edit')
    }
  })

  it('rejects a probe that completes after the worktree changes owner', async () => {
    const { promise, resolve } = Promise.withResolvers<{
      size: number
      isDirectory: boolean
      mtime: number
    }>()
    mocks.stat.mockReturnValueOnce(promise)
    const opening = openReviewWorkingFile(target)
    useAppStore.setState({
      worktreesByRepo: {
        repo: [
          {
            id: worktreeId,
            repoId: 'repo',
            path: '/repo',
            hostId: 'runtime:replacement',
            runtimeOwnerEnvironmentId: 'replacement'
          } as never
        ]
      }
    })
    resolve({ size: 0, isDirectory: false, mtime: 1 })
    expect(await opening).toBeNull()
    expect(useAppStore.getState().openFiles).toEqual([])
    expect(mocks.error).toHaveBeenCalled()
  })

  it('does not open a directory as an editable file', async () => {
    mocks.stat.mockResolvedValueOnce({ size: 0, isDirectory: true, mtime: 1 })
    expect(await openReviewWorkingFile(target)).toBeNull()
    expect(useAppStore.getState().openFiles).toEqual([])
  })
})
