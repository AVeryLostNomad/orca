import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  listRuntimeGitStashFiles,
  listRuntimeGitStashes,
  type RuntimeGitContext
} from '@/runtime/runtime-git-client'
import type { GitBranchChangeEntry } from '../../../../../../shared/git-diff-compare-types'
import type { GitStatusEntry } from '../../../../../../shared/git-status-types'
import type { GitStashEntry } from '../../../../../../shared/git-stash'
import { describeStashError } from './stash-naming'

export type SourceControlStashListState =
  | { status: 'idle' | 'loading'; stashes?: GitStashEntry[]; error?: string }
  | { status: 'refreshing' | 'ready'; stashes: GitStashEntry[]; error?: string }
  | { status: 'error'; stashes?: GitStashEntry[]; error: string }

/** Resolves the owner-host git context for the active worktree, or null when there is none. */
export type SourceControlStashGitContext = () => (RuntimeGitContext & { worktreeId: string }) | null

const EMPTY_STASH_LIST_STATE: SourceControlStashListState = { status: 'idle' }
const EMPTY_STASHES: GitStashEntry[] = []

/**
 * The stash list per worktree. `git stash list` is cheap, so it reloads whenever the working-tree
 * status changes (a stash made from a terminal changes status too); file lists load lazily on expand.
 */
export function useSourceControlStashList({
  gitContext,
  canStash,
  isBranchVisible,
  activeWorktreeId,
  worktreePath,
  entries,
  ownerHostKey,
  worktreeMap
}: {
  gitContext: SourceControlStashGitContext
  canStash: boolean
  isBranchVisible: boolean
  activeWorktreeId: string | null
  worktreePath: string | null
  entries: GitStatusEntry[]
  ownerHostKey: string
  worktreeMap: ReadonlyMap<string, unknown>
}): {
  stashListState: SourceControlStashListState
  stashes: GitStashEntry[]
  refreshStashes: () => Promise<void>
  refreshStashesRef: RefObject<() => Promise<void>>
  loadStashFiles: (stash: GitStashEntry) => Promise<GitBranchChangeEntry[]>
} {
  const [stashListByWorktree, setStashListByWorktree] = useState<
    Record<string, SourceControlStashListState>
  >({})
  const requestSeqRef = useRef(0)
  const requestByWorktreeRef = useRef<Record<string, number>>({})
  const stashListState = activeWorktreeId
    ? (stashListByWorktree[activeWorktreeId] ?? EMPTY_STASH_LIST_STATE)
    : EMPTY_STASH_LIST_STATE

  useEffect(() => {
    setStashListByWorktree((prev) => {
      let changed = false
      const next: Record<string, SourceControlStashListState> = {}
      for (const key of Object.keys(prev)) {
        if (worktreeMap.has(key)) {
          next[key] = prev[key]
        } else {
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [worktreeMap])

  const refreshStashes = useCallback(async (): Promise<void> => {
    const context = gitContext()
    if (!context || !canStash || !isBranchVisible) {
      return
    }
    const worktreeId = context.worktreeId
    const requestId = requestSeqRef.current + 1
    requestSeqRef.current = requestId
    requestByWorktreeRef.current[worktreeId] = requestId
    setStashListByWorktree((prev) => {
      const previous = prev[worktreeId]
      return {
        ...prev,
        [worktreeId]: previous?.stashes
          ? { status: 'refreshing', stashes: previous.stashes }
          : { status: 'loading' }
      }
    })
    try {
      const result = await listRuntimeGitStashes(context)
      if (requestByWorktreeRef.current[worktreeId] !== requestId) {
        return
      }
      setStashListByWorktree((prev) => ({
        ...prev,
        [worktreeId]: { status: 'ready', stashes: result.stashes }
      }))
    } catch (error) {
      if (requestByWorktreeRef.current[worktreeId] !== requestId) {
        return
      }
      // Why: an old remote host has no stash RPC; the section just stays hidden.
      console.warn('[SourceControl] stash list failed', error)
      setStashListByWorktree((prev) => {
        const previous = prev[worktreeId]
        return {
          ...prev,
          [worktreeId]: {
            status: 'error',
            stashes: previous?.stashes,
            error: describeStashError(error) ?? 'Failed to load stashes'
          }
        }
      })
    }
  }, [canStash, gitContext, isBranchVisible])
  const refreshStashesRef = useRef(refreshStashes)
  useEffect(() => {
    refreshStashesRef.current = refreshStashes
  }, [refreshStashes])

  useEffect(() => {
    if (!canStash || !isBranchVisible) {
      return
    }
    void refreshStashesRef.current()
  }, [activeWorktreeId, canStash, entries, isBranchVisible, ownerHostKey, worktreePath])

  const loadStashFiles = useCallback(
    async (stash: GitStashEntry): Promise<GitBranchChangeEntry[]> => {
      const context = gitContext()
      if (!context) {
        return []
      }
      const result = await listRuntimeGitStashFiles(context, stash.sha)
      return result.entries
    },
    [gitContext]
  )

  return {
    stashListState,
    stashes: stashListState.stashes ?? EMPTY_STASHES,
    refreshStashes,
    refreshStashesRef,
    loadStashFiles
  }
}
