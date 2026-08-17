/**
 * Tracks the PIDs of the embedded code-server processes so the memory
 * collector can attribute each server's whole process subtree — the server
 * plus its extension host, language servers, and ripgrep — to Orca's
 * footprint. The editor is one shared, reference-counted process app-wide
 * (single pid slot); Data Studio runs one process per repo (pid per repoId).
 * Local only: the embedded editors never run over SSH, so their trees are
 * always visible to the local `ps` sweep.
 *
 * Kept separate from code-server-manager.ts so the collector can read the pids
 * without importing the manager (and its Electron/spawn dependencies).
 */

let codeServerPid: number | null = null
const dataStudioPids = new Map<string, number>()

function normalizePid(pid: number | null): number | null {
  return typeof pid === 'number' && Number.isFinite(pid) && pid > 0 ? pid : null
}

export function setCodeServerPid(pid: number | null): void {
  codeServerPid = normalizePid(pid)
}

export function getCodeServerPid(): number | null {
  return codeServerPid
}

export function setDataStudioPid(repoId: string, pid: number | null): void {
  const normalized = normalizePid(pid)
  if (normalized === null) {
    dataStudioPids.delete(repoId)
  } else {
    dataStudioPids.set(repoId, normalized)
  }
}

/** Root pids of every embedded editor process: the shared editor + all Data Studio servers. */
export function getAllEmbeddedEditorPids(): number[] {
  const pids = [...dataStudioPids.values()]
  if (codeServerPid !== null) {
    pids.unshift(codeServerPid)
  }
  return pids
}
