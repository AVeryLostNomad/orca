import type { ExecutionHostId } from '../../../../shared/execution-host'

export function orderHostSectionOptions<T extends { id: ExecutionHostId }>(
  hostOptions: readonly T[],
  workspaceHostOrder: readonly ExecutionHostId[] = []
): T[] {
  if (workspaceHostOrder.length === 0 || hostOptions.length <= 1) {
    return [...hostOptions]
  }
  const hostById = new Map(hostOptions.map((host) => [host.id, host]))
  const ordered: T[] = []
  const seen = new Set<ExecutionHostId>()
  for (const hostId of workspaceHostOrder) {
    const host = hostById.get(hostId)
    if (!host || seen.has(host.id)) {
      continue
    }
    ordered.push(host)
    seen.add(host.id)
  }
  // Why: persisted order is only a preference for hosts the user has seen;
  // newly-discovered SSH/runtime hosts should still appear without needing a
  // migration or explicit reset.
  for (const host of hostOptions) {
    if (seen.has(host.id)) {
      continue
    }
    ordered.push(host)
  }
  return ordered
}
