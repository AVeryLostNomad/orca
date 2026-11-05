import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import { selectDirsToAutoLoad } from './file-explorer-loaded-listing'
import { toWorktreeRelativeDirSet } from './file-explorer-tree-relative-paths'
import { useFileExplorerConnectionState } from './use-file-explorer-connection-state'

type FileExplorerDirLoadState = {
  loadedDirs: ReadonlySet<string>
  /** Failures for folders that are no longer expanded are forgotten, so re-expanding retries. */
  failedDirs: Set<string>
  inFlightDirs: ReadonlyMap<string, unknown>
}

type UseFileExplorerListingTriggersParams = {
  enabled: boolean
  activeWorktreeId: string | null
  worktreePath: string | null
  /** New identity after every load; newly attached folders may unblock expanded children. */
  listingVersion: object
  refresh: () => Promise<void>
  loadDirs: (relativeDirs: readonly string[]) => Promise<void>
  getDirLoadState: () => FileExplorerDirLoadState
}

/** When the explorer lists: a full wave on show/connect/settings change, and folders as they expand. */
export function useFileExplorerListingTriggers({
  enabled,
  activeWorktreeId,
  worktreePath,
  listingVersion,
  refresh,
  loadDirs,
  getDirLoadState
}: UseFileExplorerListingTriggersParams): { connectionPending: boolean } {
  const getDirLoadStateRef = useRef(getDirLoadState)
  getDirLoadStateRef.current = getDirLoadState
  const { connectionStatus, connectionPending } = useFileExplorerConnectionState(activeWorktreeId)
  const followSymlinks = useAppStore((state) => state.settings?.followSymlinkedDirectories ?? false)

  useEffect(() => {
    if (!enabled || !activeWorktreeId || !worktreePath || connectionPending) {
      return
    }
    void refresh()
  }, [
    enabled,
    activeWorktreeId,
    worktreePath,
    connectionPending,
    connectionStatus,
    followSymlinks,
    refresh
  ])

  // Why: the expansion sync persists clicks into the store, so expanded dirs are the load queue.
  const storedExpanded = useAppStore((state) =>
    activeWorktreeId ? state.expandedDirs[activeWorktreeId] : undefined
  )
  useEffect(() => {
    const { loadedDirs, failedDirs, inFlightDirs } = getDirLoadStateRef.current()
    if (!enabled || !worktreePath || !loadedDirs.has('')) {
      return
    }
    const expanded = toWorktreeRelativeDirSet(storedExpanded ?? [], worktreePath)
    for (const dir of failedDirs) {
      if (!expanded.has(dir)) {
        failedDirs.delete(dir)
      }
    }
    const wanted = selectDirsToAutoLoad(
      expanded,
      loadedDirs,
      (dir) => failedDirs.has(dir) || inFlightDirs.has(dir)
    )
    if (wanted.length > 0) {
      void loadDirs(wanted)
    }
  }, [enabled, worktreePath, storedExpanded, listingVersion, loadDirs])

  return { connectionPending }
}
