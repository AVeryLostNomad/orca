import { useEffect, useRef } from 'react'
import type { FsChangedPayload } from '../../../../shared/filesystem-entry-types'
import { normalizeRuntimePathForComparison } from '../../../../shared/cross-platform-path'
import { useAppStore } from '@/store'
import {
  isWorktreeCatchUpPayload,
  ORCA_WORKTREE_FILE_CHANGE_EVENT
} from '@/hooks/worktree-file-change-event'
import {
  selectDetectedWorktreesByRepo,
  selectFolderWorkspaces,
  selectWorktreesByRepo
} from '@/store/workspace-record-selectors'
import {
  getFileExplorerOperationOwnerFromState,
  type FileExplorerOwnerState
} from './file-explorer-operation-owner'
import type { FileExplorerOperationOwner } from './file-explorer-types'
import {
  mapFsEventsToTreeFileMutations,
  type FileExplorerTreeFileMutation
} from './file-explorer-tree-watch-mutations'

const WATCH_FLUSH_RETRY_MS = 200

type FileTreeWatchRequiredField =
  | 'settings'
  | 'repos'
  | 'worktreesByRepo'
  | 'detectedWorktreesByRepo'
  | 'folderWorkspaces'

type FileTreeWatchOwnerState = Pick<FileExplorerOwnerState, FileTreeWatchRequiredField> &
  Partial<Omit<FileExplorerOwnerState, FileTreeWatchRequiredField>>

export function getFileTreeWatchRuntimeEnvironmentId(
  state: FileTreeWatchOwnerState,
  activeWorktreeId: string | null,
  expectedOwner?: FileExplorerOperationOwner
): string | null | undefined {
  const ownerState: FileExplorerOwnerState = {
    activeWorktreeId: state.activeWorktreeId,
    activeWorkspaceExecutionHostId: state.activeWorkspaceExecutionHostId,
    settings: state.settings,
    repos: state.repos,
    worktreesByRepo: selectWorktreesByRepo(state),
    detectedWorktreesByRepo: selectDetectedWorktreesByRepo(state) ?? {},
    folderWorkspaces: selectFolderWorkspaces(state) ?? [],
    projectGroups: state.projectGroups ?? [],
    restoredRuntimeHostIdByWorkspaceSessionKey:
      state.restoredRuntimeHostIdByWorkspaceSessionKey ?? {}
  }
  const owner = getFileExplorerOperationOwnerFromState(ownerState, activeWorktreeId)
  if (expectedOwner && JSON.stringify(owner) !== JSON.stringify(expectedOwner)) {
    return undefined
  }
  return owner.kind === 'runtime'
    ? owner.environmentId
    : owner.kind === 'unresolved'
      ? undefined
      : null
}

type UseFileTreeWatchParams = {
  enabled: boolean
  activeWorktreeId: string | null
  worktreePath: string | null
  operationOwner: FileExplorerOperationOwner | undefined
  /** Defer reconciliation while an inline rename/create or drag is in flight. */
  isInteractionActive: () => boolean
  getKnownFiles: () => readonly string[]
  applyExternalFileMutations: (mutations: readonly FileExplorerTreeFileMutation[]) => void
  refreshFileList: () => void
}

/**
 * Applies filesystem watcher events for the active worktree as @pierre/trees
 * mutations, escalating to a full flat-list refresh on overflow.
 *
 * Why: `useEditorExternalWatch` owns the watch IPC lifecycle; this hook only
 * subscribes to fs:changed for tree reconciliation.
 */
export function useFileTreeWatch({
  enabled,
  activeWorktreeId,
  worktreePath,
  operationOwner,
  isInteractionActive,
  getKnownFiles,
  applyExternalFileMutations,
  refreshFileList
}: UseFileTreeWatchParams): void {
  // Why: subscriptions follow the selected worktree; host focus is only a
  // legacy default, not an ownership signal.
  const activeRuntimeEnvironmentId = useAppStore((s) =>
    getFileTreeWatchRuntimeEnvironmentId(s, activeWorktreeId, operationOwner)
  )

  const isInteractionActiveRef = useRef(isInteractionActive)
  isInteractionActiveRef.current = isInteractionActive
  const getKnownFilesRef = useRef(getKnownFiles)
  getKnownFilesRef.current = getKnownFiles
  const applyRef = useRef(applyExternalFileMutations)
  applyRef.current = applyExternalFileMutations
  const refreshRef = useRef(refreshFileList)
  refreshRef.current = refreshFileList

  useEffect(() => {
    if (
      !enabled ||
      !worktreePath ||
      !activeWorktreeId ||
      activeRuntimeEnvironmentId === undefined
    ) {
      return
    }
    const currentWorktreePath = worktreePath
    let disposed = false
    const deferred: FsChangedPayload[] = []
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    const process = (payload: FsChangedPayload): void => {
      const { mutations, needsFullRelist } = mapFsEventsToTreeFileMutations({
        payload,
        worktreePath: currentWorktreePath,
        files: getKnownFilesRef.current()
      })
      if (needsFullRelist) {
        refreshRef.current()
        return
      }
      if (mutations.length > 0) {
        applyRef.current(mutations)
      }
    }

    const scheduleFlush = (): void => {
      if (flushTimer !== null) {
        return
      }
      flushTimer = setTimeout(() => {
        flushTimer = null
        if (disposed) {
          return
        }
        if (isInteractionActiveRef.current()) {
          scheduleFlush()
          return
        }
        for (const payload of deferred.splice(0)) {
          process(payload)
        }
      }, WATCH_FLUSH_RETRY_MS)
    }

    const handleFsChanged = (payload: FsChangedPayload): void => {
      if (disposed) {
        return
      }
      if (
        normalizeRuntimePathForComparison(payload.worktreePath) !==
        normalizeRuntimePathForComparison(currentWorktreePath)
      ) {
        return
      }
      // Why: defer reconciliation during inline rename/create and drags so
      // model mutations don't cancel the user's in-flight gesture.
      if (isInteractionActiveRef.current() || deferred.length > 0) {
        deferred.push(payload)
        scheduleFlush()
        return
      }
      process(payload)
    }

    const handleRuntimeChange = (
      event: WindowEventMap[typeof ORCA_WORKTREE_FILE_CHANGE_EVENT]
    ): void => {
      if (event.detail.runtimeEnvironmentId === activeRuntimeEnvironmentId) {
        handleFsChanged(event.detail.payload)
      }
    }
    // IPC trees also need the synthesized catch-up after watch reacquisition.
    const handleCatchUp = (event: WindowEventMap[typeof ORCA_WORKTREE_FILE_CHANGE_EVENT]): void => {
      if (
        event.detail.runtimeEnvironmentId === null &&
        isWorktreeCatchUpPayload(event.detail.payload)
      ) {
        handleFsChanged(event.detail.payload)
      }
    }
    let unsubscribeListener: (() => void) | null = null
    if (activeRuntimeEnvironmentId?.trim()) {
      // Why: the app watcher owns recovery; a separate stream would strand this consumer after reconnect.
      window.addEventListener(ORCA_WORKTREE_FILE_CHANGE_EVENT, handleRuntimeChange)
    } else {
      unsubscribeListener = window.api.fs.onFsChanged(handleFsChanged)
      window.addEventListener(ORCA_WORKTREE_FILE_CHANGE_EVENT, handleCatchUp)
    }

    return () => {
      disposed = true
      window.removeEventListener(ORCA_WORKTREE_FILE_CHANGE_EVENT, handleRuntimeChange)
      window.removeEventListener(ORCA_WORKTREE_FILE_CHANGE_EVENT, handleCatchUp)
      unsubscribeListener?.()
      if (flushTimer !== null) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      if (deferred.length > 0) {
        // Why: events dropped mid-gesture still need reconciling; a relist
        // covers them once the new subscription (or re-enable) settles.
        deferred.length = 0
        refreshRef.current()
      }
    }
  }, [enabled, worktreePath, activeWorktreeId, activeRuntimeEnvironmentId])
}
