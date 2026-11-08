import { useCallback, useState } from 'react'
import { useAppStore } from '@/store'
import { FILE_EXPLORER_FULL_ROOT, type ExplorerRootOption } from './file-explorer-display-root'

export function useFileExplorerRootNavigation(
  worktreeId: string | null,
  choice: string,
  options: ExplorerRootOption[] | null
) {
  const [returnTarget, setReturnTarget] = useState<{ worktreeId: string; choice: string } | null>(
    null
  )
  const selectRoot = useCallback(
    (value: string) => {
      if (!worktreeId) {
        return
      }
      setReturnTarget(null)
      const state = useAppStore.getState()
      state.clearPendingExplorerReveal()
      state.setExplorerDisplayRootForWorktree(worktreeId, value)
    },
    [worktreeId]
  )
  /** Leaves the current root for `target` (default: the full root) and remembers the way back. */
  const revealOutsideRoot = useCallback(
    (target: string = FILE_EXPLORER_FULL_ROOT) => {
      if (!worktreeId || choice === target) {
        return
      }
      setReturnTarget({ worktreeId, choice })
      useAppStore.getState().setExplorerDisplayRootForWorktree(worktreeId, target)
    },
    [worktreeId, choice]
  )
  const returnRoot =
    choice === FILE_EXPLORER_FULL_ROOT && returnTarget?.worktreeId === worktreeId
      ? (options?.find((option) => option.value === returnTarget.choice) ?? null)
      : null
  return { selectRoot, revealOutsideRoot, returnRoot }
}
