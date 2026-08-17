import {
  queryWindowsProcessRowsFresh,
  type WindowsProcessRow
} from '../providers/windows-foreground-process-rows'
import { terminateWindowsProcessTree, type WindowsTreeKiller } from '../windows-process-tree-kill'

export type WindowsCodeServerTerminationDeps = {
  killWindowsTree?: WindowsTreeKiller
  readProcessRows?: () => Promise<WindowsProcessRow[]>
}

// Kill the live code-server child's whole tree. SIGTERM on Windows terminates
// only the root node.exe and orphans the extension host / LSPs / ripgrep, so
// route through taskkill /T /F. No identity probe needed: the caller still
// holds the ChildProcess, and Node keeps the process handle open until 'exit'
// fires, so this PID cannot have been recycled.
export function killWindowsCodeServerTree(
  pid: number,
  deps: WindowsCodeServerTerminationDeps = {}
): Promise<void> {
  const killTree = deps.killWindowsTree ?? terminateWindowsProcessTree
  return killTree(pid)
}

// Reap a prior run's orphan recorded in the pidfile. Unlike the live-child
// case, this PID may have been recycled since that run died, and taskkill /T /F
// on a recycled PID is a real blast radius. The ancestry gate in
// windows-pty-root-identity.ts can't apply (an orphan is never our descendant),
// so require positive content identity instead: only a process whose command
// line or executable references our code-server install may be killed.
// Ambiguity is not evidence of ownership — absent row, foreign row, or a failed
// process query all mean "don't kill" (the caller still deletes the pidfile).
export async function reapWindowsCodeServerOrphan(
  pid: number,
  cacheRoot: string,
  deps: WindowsCodeServerTerminationDeps = {}
): Promise<void> {
  const readRows = deps.readProcessRows ?? queryWindowsProcessRowsFresh
  let rows: WindowsProcessRow[]
  try {
    rows = await readRows()
  } catch {
    return
  }
  const row = rows.find((r) => r.pid === pid)
  if (!row || !isCodeServerProcessRow(row, cacheRoot)) {
    return
  }
  const killTree = deps.killWindowsTree ?? terminateWindowsProcessTree
  await killTree(pid)
}

// Windows paths are case-insensitive; process command lines may quote or
// forward-slash the install path, so compare with separators normalized.
function isCodeServerProcessRow(row: WindowsProcessRow, cacheRoot: string): boolean {
  const needle = normalizeForPathCompare(cacheRoot)
  return (
    normalizeForPathCompare(row.command).includes(needle) ||
    normalizeForPathCompare(row.executablePath).includes(needle)
  )
}

function normalizeForPathCompare(value: string): string {
  return value.replace(/\//g, '\\').toLowerCase()
}
