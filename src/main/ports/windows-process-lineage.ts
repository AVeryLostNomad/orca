const MAX_ANCESTOR_DEPTH = 32

type ProcessLineageRow = { pid: number; ppid: number; creationTimeMs?: number }

/**
 * Windows keeps a dead parent's pid in ppid, and pids are reused, so a link only counts when the parent
 * started before the child. Windows lacks a cwd for other processes; lineage is how a `dotnet run` or a
 * global `vite` started from a workspace terminal gets attributed to that workspace.
 */
export function windowsAncestorPids(
  row: ProcessLineageRow,
  byPid: ReadonlyMap<number, ProcessLineageRow>
): number[] {
  const ancestors: number[] = []
  const seen = new Set([row.pid])
  let child = row
  while (ancestors.length < MAX_ANCESTOR_DEPTH) {
    const parent = byPid.get(child.ppid)
    if (!parent || seen.has(parent.pid)) {
      break
    }
    if (
      parent.creationTimeMs !== undefined &&
      child.creationTimeMs !== undefined &&
      parent.creationTimeMs > child.creationTimeMs
    ) {
      break
    }
    ancestors.push(parent.pid)
    seen.add(parent.pid)
    child = parent
  }
  return ancestors
}
