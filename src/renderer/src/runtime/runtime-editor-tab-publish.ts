import { FILE_OPEN_BACKGROUND_RUNTIME_CAPABILITY } from '../../../shared/protocol-version'
import { isSafeWorktreeRelativePath } from '../../../shared/worktree-relative-path-safety'
import type { OpenFile } from '@/store/slices/editor'
import type { AppState } from '@/store/types'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'
import { recordWebSessionCloseIntent } from './web-session-close-intent'

type PendingEditorPublish = {
  closed: boolean
}

const pendingEditorPublishes = new Map<string, PendingEditorPublish>()

function runtimeEditorTabKey(
  environmentId: string,
  file: Pick<OpenFile, 'worktreeId' | 'filePath' | 'mode' | 'diffSource'>
): string {
  return `${environmentId}\0${file.worktreeId}\0${file.filePath}\0${file.mode}\0${file.diffSource ?? ''}`
}

function runtimeEditorPublishEnvironment(state: AppState, file: OpenFile): string | null {
  if (
    file.mirroredFromRuntimeSession ||
    file.isPreview ||
    file.readOnly ||
    file.isUntitled ||
    file.isScratch ||
    file.externalSshTargetId ||
    file.workspaceNotesOwnerId ||
    !isSafeWorktreeRelativePath(file.relativePath)
  ) {
    return null
  }
  const isPublishableDiff =
    file.mode === 'diff' && (file.diffSource === 'staged' || file.diffSource === 'unstaged')
  if (file.mode !== 'edit' && !isPublishableDiff) {
    return null
  }
  const environmentId = getRuntimeEnvironmentIdForWorktree(state, file.worktreeId)
  return environmentId && file.runtimeEnvironmentId === environmentId ? environmentId : null
}

function canPublishRuntimeEditorTab(state: AppState, file: OpenFile): string | null {
  const environmentId = runtimeEditorPublishEnvironment(state, file)
  if (!environmentId) {
    return null
  }
  const capabilities = state.runtimeStatusByEnvironmentId.get(environmentId)?.status?.capabilities
  return capabilities?.includes(FILE_OPEN_BACKGROUND_RUNTIME_CAPABILITY) ? environmentId : null
}

export function publishRuntimeEditorTab(state: AppState, fileId: string): void {
  const file = state.openFiles.find((candidate) => candidate.id === fileId)
  if (!file) {
    return
  }
  const environmentId = canPublishRuntimeEditorTab(state, file)
  if (!environmentId) {
    return
  }
  const key = runtimeEditorTabKey(environmentId, file)
  if (pendingEditorPublishes.has(key)) {
    return
  }
  const pending: PendingEditorPublish = { closed: false }
  pendingEditorPublishes.set(key, pending)
  const params = {
    worktree: toRuntimeWorktreeSelector(file.worktreeId),
    relativePath: file.relativePath,
    activate: false
  }
  const method = file.mode === 'diff' ? 'files.openDiff' : 'files.open'
  const requestParams =
    file.mode === 'diff' ? { ...params, staged: file.diffSource === 'staged' } : params
  void import('./runtime-rpc-client')
    .then(({ callRuntimeRpc }) =>
      callRuntimeRpc({ kind: 'environment', environmentId }, method, requestParams, {
        timeoutMs: 15_000
      })
    )
    .catch(() => {
      if (pendingEditorPublishes.get(key) === pending) {
        pendingEditorPublishes.delete(key)
      }
    })
}

export function markRuntimeEditorTabPublishClosed(
  state: AppState,
  file: OpenFile | undefined
): void {
  if (!file) {
    return
  }
  const environmentId = runtimeEditorPublishEnvironment(state, file)
  if (!environmentId) {
    return
  }
  const pending = pendingEditorPublishes.get(runtimeEditorTabKey(environmentId, file))
  if (pending) {
    pending.closed = true
  }
}

/** Settles a pending publish once the host echoes it; true when the user already closed it. */
export function adoptPublishedRuntimeEditorTab(
  environmentId: string,
  file: OpenFile,
  hostTabId: string
): boolean {
  const key = runtimeEditorTabKey(environmentId, file)
  const pending = pendingEditorPublishes.get(key)
  if (!pending) {
    return false
  }
  pendingEditorPublishes.delete(key)
  if (!pending.closed) {
    return false
  }
  recordWebSessionCloseIntent({ environmentId }, file.worktreeId, hostTabId, Date.now())
  void import('./web-runtime-session').then(({ closeWebRuntimeSessionTab }) =>
    closeWebRuntimeSessionTab({
      worktreeId: file.worktreeId,
      tabId: hostTabId,
      environmentId,
      reason: 'user'
    })
  )
  return true
}

export function resetRuntimeEditorTabPublishesForTests(): void {
  pendingEditorPublishes.clear()
}
