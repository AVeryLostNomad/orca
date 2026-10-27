import { useAppStore } from '@/store'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { selectWorktreeHostConnectionPhase } from '@/lib/worktree-host-connection-phase'
import { WORKTREE_OWNER_NOT_READY_ERROR, type FileContent } from './editor-panel-content-types'

/** The load-error content a failed editor read shows. */
export function describeEditorFileLoadFailure(
  err: unknown,
  worktreeId: string | undefined,
  readConnectionId: string | undefined
): FileContent {
  const hostConnection = selectWorktreeHostConnectionPhase(
    useAppStore.getState(),
    worktreeId ?? null
  )
  // Connection failures while SSH connects should wait for readiness instead of appearing as file errors.
  const hostConnecting =
    hostConnection.phase === 'connecting' &&
    readConnectionId !== undefined &&
    readConnectionId === hostConnection.targetId
  const message = hostConnecting
    ? WORKTREE_OWNER_NOT_READY_ERROR
    : err instanceof Error
      ? err.message
      : String(err)
  // Preserve machine error codes separately because hosts may render prose-only messages.
  const loadErrorCode = !hostConnecting && err instanceof RuntimeRpcCallError ? err.code : undefined
  return {
    content: '',
    isBinary: false,
    loadError: message,
    ...(loadErrorCode ? { loadErrorCode } : {})
  }
}
