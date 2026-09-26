// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useAppStore } from '@/store'
import { useGitHistoryCommitActions } from './use-git-history-commit-actions'

vi.mock('@/runtime/runtime-file-metadata-client', () => ({
  statRuntimePath: vi.fn().mockResolvedValue({ size: 4, isDirectory: false, mtime: 1 })
}))

const worktreeId = 'repo::/repo'

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  useAppStore.setState({
    activeWorktreeId: worktreeId,
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
})
afterEach(cleanup)

it('opens the renamed current path without a cached historical comparison', async () => {
  const { result } = renderHook(() =>
    useGitHistoryCommitActions({
      activeWorktreeId: worktreeId,
      worktreePath: '/repo',
      activeRepoSettings: null,
      resolveSplitTargetGroupId: () => undefined
    })
  )
  const item = {
    id: 'historical-commit',
    parentIds: ['parent'],
    subject: 'rename',
    message: 'rename'
  }
  const entry = { path: 'current.ts', oldPath: 'old.ts', status: 'renamed' as const }

  act(() => result.current.openCommitFile(item, entry))
  expect(useAppStore.getState().openFiles).toEqual([])

  await act(async () =>
    result.current.openCommitFile(item, entry, {
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      target: 'file',
      openAsPermanent: true
    })
  )
  await waitFor(() =>
    expect(useAppStore.getState().openFiles).toEqual([
      expect.objectContaining({ filePath: '/repo/current.ts', mode: 'edit' })
    ])
  )
  const state = useAppStore.getState()
  expect(state.openFiles[0]?.diffSource).toBeUndefined()
  expect(Object.values(state.workingDocuments)[0]?.target.filePath).toBe('/repo/current.ts')
})
