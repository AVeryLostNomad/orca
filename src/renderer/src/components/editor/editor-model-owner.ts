import type { OpenFile } from '@/store/slices/editor'
import type { WorktreeOperationRouteState } from '@/lib/worktree-operation-route'
import { resolveEditorOwnerRoute } from '@/lib/editor-file-operation-owner'
import { toRuntimeExecutionHostId, toSshExecutionHostId } from '../../../../shared/execution-host'

export type EditorModelOwner = { environmentId: string | null; hostId: string | null }

export function resolveEditorModelOwner(
  file: Pick<
    OpenFile,
    'worktreeId' | 'runtimeEnvironmentId' | 'externalSshTargetId' | 'operationProvenance'
  >,
  state: WorktreeOperationRouteState
): EditorModelOwner {
  const captured = file.operationProvenance?.generation.route
  const owner = captured ? null : resolveEditorOwnerRoute(state, file.worktreeId)
  const route = captured ?? (owner?.kind === 'resolved' ? owner.route : null)
  const environmentId = captured
    ? captured.runtimeEnvironmentId
    : file.runtimeEnvironmentId !== undefined
      ? file.runtimeEnvironmentId?.trim() || null
      : (route?.runtimeEnvironmentId ?? null)
  const hostId = captured
    ? captured.executionHostId
    : file.externalSshTargetId
      ? toSshExecutionHostId(file.externalSshTargetId)
      : route &&
          (file.runtimeEnvironmentId === undefined ||
            (file.runtimeEnvironmentId || null) === route.runtimeEnvironmentId)
        ? route.executionHostId
        : environmentId
          ? toRuntimeExecutionHostId(environmentId)
          : null
  return { environmentId, hostId }
}

/** The owner key of a resolved owner; null while its host is unknown. */
export function resolvedEditorModelOwnerKey({
  environmentId,
  hostId
}: EditorModelOwner): string | null {
  if (!hostId) {
    return null
  }
  return hostId === 'local' && !environmentId ? '' : JSON.stringify([environmentId, hostId])
}

export function getEditorModelOwnerKey(file: OpenFile, state: WorktreeOperationRouteState): string {
  const owner = resolveEditorModelOwner(file, state)
  // Unresolved owners must not borrow another host's retained text.
  return (
    resolvedEditorModelOwnerKey(owner) ??
    JSON.stringify([owner.environmentId, 'unresolved', file.worktreeId, file.id])
  )
}
