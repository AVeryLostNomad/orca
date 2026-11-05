import { joinPath } from '@/lib/path'
import { getConnectionId } from '@/lib/connection-context'
import { readRuntimeDirectory } from '@/runtime/runtime-file-mutation-client'
import { getRuntimeGitIgnoredPaths } from '@/runtime/runtime-git-status-client'
import type { DirEntry } from '../../../../shared/filesystem-entry-types'
import { mapSettledWithConcurrency } from '../../../../shared/map-with-concurrency'
import { getFileExplorerOperationRoute } from './file-explorer-operation-owner'
import type { FileExplorerOperationOwner } from './file-explorer-types'
import { getWorktreeGitOwnerTarget } from './worktree-git-owner-target'

// Why: a refresh re-reads every loaded folder; bound fan-out so SSH/runtime hosts aren't flooded.
const DIR_READ_CONCURRENCY = 8

export type FileExplorerDirReader = (relativeDir: string) => Promise<DirEntry[]>

export function createFileExplorerDirReader(
  worktreeId: string,
  worktreePath: string,
  owner: FileExplorerOperationOwner
): FileExplorerDirReader | null {
  const route = getFileExplorerOperationRoute(owner)
  if (!route) {
    return null
  }
  const context = {
    target: route.target,
    worktreeId,
    worktreePath,
    connectionId: route.connectionId
  }
  return (relativeDir) =>
    readRuntimeDirectory(context, relativeDir ? joinPath(worktreePath, relativeDir) : worktreePath)
}

/** Read dirs in parallel; failures are reported per dir so one unreadable folder can't sink a refresh. */
export async function readFileExplorerDirs(
  read: FileExplorerDirReader,
  dirs: readonly string[]
): Promise<{
  listings: Map<string, DirEntry[]>
  failures: Map<string, unknown>
}> {
  const settled = await mapSettledWithConcurrency(dirs, DIR_READ_CONCURRENCY, read)
  const listings = new Map<string, DirEntry[]>()
  const failures = new Map<string, unknown>()
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      listings.set(dirs[index], result.value)
    } else {
      failures.set(dirs[index], result.reason)
    }
  })
  return { listings, failures }
}

/** Gitignored subset of `relativePaths` (directory rows included); [] when the owner can't answer. */
export async function readFileExplorerIgnoredPaths(
  worktreeId: string,
  worktreePath: string,
  relativePaths: readonly string[]
): Promise<string[]> {
  const target = getWorktreeGitOwnerTarget(worktreeId)
  if (!target || relativePaths.length === 0) {
    return []
  }
  try {
    return await getRuntimeGitIgnoredPaths(
      { target, worktreeId, worktreePath, connectionId: getConnectionId(worktreeId) ?? undefined },
      relativePaths.map((path) => (path.endsWith('/') ? path.slice(0, -1) : path))
    )
  } catch {
    return []
  }
}

/** Split a request into folders already loading (await them) and folders to read now. */
export function partitionDirLoads(
  relativeDirs: readonly string[],
  inFlight: ReadonlyMap<string, Promise<void>>,
  loadedDirs: ReadonlySet<string>
): { waiting: Promise<void>[]; pending: string[] } {
  const waiting: Promise<void>[] = []
  const pending: string[] = []
  for (const dir of new Set(relativeDirs)) {
    const loading = inFlight.get(dir)
    if (loading) {
      waiting.push(loading)
    } else if (!loadedDirs.has(dir)) {
      pending.push(dir)
    }
  }
  return { waiting, pending }
}

export function trackInFlightDirLoad(
  inFlight: Map<string, Promise<void>>,
  dirs: readonly string[],
  load: Promise<void>
): void {
  for (const dir of dirs) {
    inFlight.set(dir, load)
  }
  void load.then(() => {
    for (const dir of dirs) {
      if (inFlight.get(dir) === load) {
        inFlight.delete(dir)
      }
    }
  })
}
