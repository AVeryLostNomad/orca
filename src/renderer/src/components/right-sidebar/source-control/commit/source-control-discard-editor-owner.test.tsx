// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { runtimeTargetForOwnerEnvironment } from '@/runtime/runtime-client-target'
import type { RuntimeClientTarget } from '../../../../../../shared/runtime-client-target'
import { beforeEach, expect, it, vi } from 'vitest'
import type { EditorPathMutationTarget } from '@/components/editor/editor-autosave'

const mocks = vi.hoisted(() => {
  const focus: { value: string | null } = { value: null }
  return {
    focus,
    hold: vi.fn<(documentId: string) => Promise<() => void>>(),
    workingDocuments: {} as Record<string, unknown>,
    notify: vi.fn<(target: EditorPathMutationTarget) => void>(),
    discard: vi.fn(),
    bulkDiscard: vi.fn()
  }
})
vi.mock('@/lib/connection-context', () => ({ getConnectionId: () => undefined }))
vi.mock('@/components/editor/editor-autosave', () => ({
  holdDocumentAutosave: mocks.hold,
  notifyEditorExternalFileChange: mocks.notify
}))
vi.mock('@/runtime/runtime-git-working-tree-client', () => ({
  discardRuntimeGitPath: mocks.discard,
  bulkDiscardRuntimeGitPaths: mocks.bulkDiscard,
  stageRuntimeGitPath: vi.fn(),
  unstageRuntimeGitPath: vi.fn(),
  bulkUnstageRuntimeGitPaths: vi.fn()
}))
vi.mock('@/store', () => ({
  useAppStore: Object.assign(() => undefined, {
    getState: () => ({
      settings: { activeRuntimeEnvironmentId: mocks.focus.value },
      workingDocuments: mocks.workingDocuments
    })
  })
}))
import { useSourceControlEntryMutations } from './use-entry-mutations'

// Fork editor model: each open path is a working document owned by one runtime.
const documentId = (relativePath: string, runtime: string | null): string =>
  `${runtime ?? 'local'}:${relativePath}`

function seedDocuments(paths: readonly string[], runtimes: readonly (string | null)[]): void {
  mocks.workingDocuments = {}
  for (const relativePath of paths) {
    for (const runtimeEnvironmentId of runtimes) {
      const id = documentId(relativePath, runtimeEnvironmentId)
      mocks.workingDocuments[id] = {
        id,
        target: { worktreeId: 'wt-owner', relativePath, owner: { runtimeEnvironmentId } }
      }
    }
  }
}

beforeEach(() => vi.clearAllMocks())

for (const bulk of [false, true]) {
  it.each([
    { name: 'managed repo with local focus', owner: 'host-a', focus: null },
    { name: 'managed repo with another host focused', owner: 'host-a', focus: 'host-b' },
    { name: 'desktop repo with remote focus', owner: null, focus: 'host-b' }
  ])(
    `${bulk ? 'bulk' : 'single'} discard waits for the $name editor saves`,
    async ({ owner, focus }) => {
      mocks.focus.value = focus
      let release: () => void = () => {}
      const releaseHold = (): void => {}
      const pendingSave = new Promise<() => void>((resolve) => {
        release = () => resolve(releaseHold)
      })
      const paths = bulk ? ['first.txt', 'second.txt'] : ['first.txt']
      // The same paths are also open on the focused host; only the owner's may be held.
      seedDocuments(paths, [owner, focus])
      mocks.hold.mockImplementation((id) =>
        id.startsWith(`${owner ?? 'local'}:`) ? pendingSave : Promise.resolve(releaseHold)
      )
      const activeRepoTarget: RuntimeClientTarget | null = runtimeTargetForOwnerEnvironment(owner)
      const { result } = renderHook(() =>
        useSourceControlEntryMutations({
          activeRepoTarget,
          activeWorktreeId: 'wt-owner',
          worktreePath: '/repo',
          refreshActiveGitStatusAfterMutation: async () => {}
        })
      )
      let discarded: Promise<void> = Promise.resolve()
      await act(async () => {
        discarded = bulk
          ? result.current.discardMany(paths)
          : result.current.discardSingle(paths[0])
        await Promise.resolve()
        await Promise.resolve()
      })
      const invokedBeforeSaveFinished = (bulk ? mocks.bulkDiscard : mocks.discard).mock.calls.length
      release()
      await act(async () => {
        await discarded
      })
      expect(invokedBeforeSaveFinished).toBe(0)
      expect(mocks.hold.mock.calls.map(([id]) => id)).toEqual(
        paths.map((relativePath) => documentId(relativePath, owner))
      )
      expect(mocks.notify.mock.calls.map(([target]) => target)).toEqual(
        paths.map((relativePath) => ({
          worktreeId: 'wt-owner',
          worktreePath: '/repo',
          relativePath,
          runtimeEnvironmentId: owner
        }))
      )
      const mutation = bulk ? mocks.bulkDiscard : mocks.discard
      expect(mutation).toHaveBeenCalledTimes(1)
      expect(mutation.mock.calls[0]?.[0]).toMatchObject({ target: activeRepoTarget })
    }
  )
}
