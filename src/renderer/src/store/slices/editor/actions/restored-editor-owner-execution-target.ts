import { parseExecutionHostId } from '../../../../../../shared/execution-host'

export function resolveRestoredEditorExternalSshTargetId(
  targetExecutionHostId: string,
  targetRuntimeEnvironmentId: string | null
): string | undefined {
  const parsedHost = parseExecutionHostId(targetExecutionHostId)
  return parsedHost?.kind === 'ssh' && targetRuntimeEnvironmentId === null
    ? parsedHost.targetId
    : undefined
}
