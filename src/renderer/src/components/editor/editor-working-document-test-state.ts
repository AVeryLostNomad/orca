import { createWorkingDocumentState } from '@/store/slices/editor/actions/working-document-actions'
import { buildWorkingDocumentTarget } from '@/store/slices/editor/working-document'
import type { OpenFile } from '@/store/slices/editor'

/**
 * Supplies the real document actions to editor-content tests while retaining each test's focused
 * runtime/worktree overrides. The production loader mutates these actions, so plain echo mocks
 * would hide ownership and dirty-baseline regressions.
 */
export function createEditorWorkingDocumentTestState(base: Record<string, unknown>) {
  const state: Record<string, unknown> = {
    repos: [],
    worktreesByRepo: {},
    unifiedTabsByWorktree: {},
    openFiles: [],
    workingDocuments: {},
    workingDocumentIdsByTab: {},
    ...base
  }
  const workingDocuments = state.workingDocuments
  const workingDocumentIdsByTab = state.workingDocumentIdsByTab
  const set = (update: unknown): void => {
    const patch =
      typeof update === 'function'
        ? (update as (current: Record<string, unknown>) => Record<string, unknown>)(state)
        : update
    Object.assign(state, patch)
  }
  Object.assign(state, createWorkingDocumentState(set as never, (() => state) as never), {
    workingDocuments,
    workingDocumentIdsByTab
  })
  return state
}

type TestOpenFile = Pick<
  OpenFile,
  | 'id'
  | 'filePath'
  | 'worktreeId'
  | 'relativePath'
  | 'language'
  | 'mode'
  | 'diffSource'
  | 'readOnly'
  | 'externalSshTargetId'
>
export function primeEditorWorkingDocumentTestState(
  state: Record<string, unknown>,
  openFiles: readonly TestOpenFile[],
  getConnectionIdForFile: (worktreeId: string, filePath: string) => string | undefined
): void {
  const openFileIds = new Set(openFiles.map((file) => file.id))
  const releaseWorkingDocumentsForTab = state.releaseWorkingDocumentsForTab as
    | ((tabId: string) => void)
    | undefined
  if (releaseWorkingDocumentsForTab) {
    for (const tabId of Object.keys(
      state.workingDocumentIdsByTab as Record<string, readonly string[]>
    )) {
      if (!openFileIds.has(tabId)) {
        releaseWorkingDocumentsForTab(tabId)
      }
    }
  }
  const existingWorktreesByRepo = (state.worktreesByRepo ?? {}) as Record<
    string,
    readonly Record<string, unknown>[]
  >
  const connectionIds = new Set<string>()
  const worktreesByRepo: Record<string, readonly Record<string, unknown>[]> = {}
  const handledWorktreeIds = new Set<string>()
  for (const [repoId, worktrees] of Object.entries(existingWorktreesByRepo)) {
    worktreesByRepo[repoId] = worktrees.map((worktree) => {
      const file = openFiles.find((candidate) => candidate.worktreeId === worktree.id)
      if (!file) {
        return worktree
      }
      handledWorktreeIds.add(file.worktreeId)
      const connectionId =
        getConnectionIdForFile(file.worktreeId, file.filePath) ?? file.externalSshTargetId
      if (connectionId) {
        connectionIds.add(connectionId)
      }
      if (connectionId) {
        worktree.hostId = `ssh:${connectionId}`
      } else if (!worktree.hostId) {
        worktree.hostId = 'local'
      }
      return worktree
    })
  }
  const missingWorktrees = openFiles
    .filter((file) => !handledWorktreeIds.has(file.worktreeId))
    .map((file) => {
      const connectionId =
        getConnectionIdForFile(file.worktreeId, file.filePath) ?? file.externalSshTargetId
      if (connectionId) {
        connectionIds.add(connectionId)
      }
      return {
        id: file.worktreeId,
        repoId: 'editor-content-test',
        path: file.filePath,
        hostId: connectionId ? `ssh:${connectionId}` : 'local'
      }
    })
  if (missingWorktrees.length > 0) {
    worktreesByRepo['editor-content-test'] = [
      ...(worktreesByRepo['editor-content-test'] ?? []),
      ...missingWorktrees
    ]
  }
  state.openFiles = [...openFiles]
  state.repos =
    ((state.repos as readonly unknown[] | undefined)?.length ?? 0) > 0
      ? state.repos
      : [{ id: 'editor-content-test', executionHostId: 'local' }]
  state.worktreesByRepo = worktreesByRepo
  state.sshConnectionStates = new Map(
    [...connectionIds].map((connectionId) => [connectionId, { connectionGeneration: 1 }])
  )
  state.sshStateByEnvironment = new Map()
  const retainWorkingDocument = state.retainWorkingDocument as
    | ((tabId: string, target: ReturnType<typeof buildWorkingDocumentTarget>) => void)
    | undefined
  if (retainWorkingDocument) {
    for (const file of openFiles) {
      if (
        !file.readOnly &&
        (file.mode === 'edit' ||
          file.mode === 'markdown-preview' ||
          (file.mode === 'diff' && file.diffSource === 'unstaged'))
      ) {
        retainWorkingDocument(file.id, buildWorkingDocumentTarget(state as never, file as never))
      }
    }
  }
}
