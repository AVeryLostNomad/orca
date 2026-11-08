import { useCallback, useMemo } from 'react'
import { useAppStore } from '@/store'
import { getRelativePathInsideRoot, joinPath } from '@/lib/path'
import { useUnityWorkspaceProjectRoots } from '@/components/unity/unity-workbench-store'
import {
  getUnityExplorerScopeOptions,
  resolveUnityExplorerScopeChoice
} from '@/components/unity/unity-explorer-scope'
import {
  FILE_EXPLORER_FULL_ROOT,
  getExplorerDisplayRootPath,
  type ExplorerRootOption
} from './file-explorer-display-root'
import { useFileExplorerRootNavigation } from './use-file-explorer-root-navigation'

export type FileExplorerUnityScope = {
  /** Scope choices; null outside local Unity workspaces (no dropdown, whole tree). */
  options: ExplorerRootOption[] | null
  choice: string
  /** Absolute directory the tree is rooted at. */
  treeRootPath: string | null
  selectScope: (value: string) => void
  /** Explicit reveal outside the scope: switch to the scope holding it, else the whole folder. Unset when unscoped. */
  revealOutsideScope: ((absolutePath: string) => void) | undefined
}

/** Unity-style explorer root (Assets / Packages / whole folder), persisted per workspace. */
export function useFileExplorerUnityScope(
  worktreeId: string | null,
  worktreePath: string | null
): FileExplorerUnityScope {
  const projectRoots = useUnityWorkspaceProjectRoots(worktreeId)
  const options = useMemo(
    () => getUnityExplorerScopeOptions(projectRoots, worktreePath),
    [projectRoots, worktreePath]
  )
  const saved = useAppStore((s) =>
    worktreeId ? s.explorerDisplayRootByWorktree[worktreeId] : undefined
  )
  const defaultScope = useAppStore((s) => s.settings?.unityExplorerDefaultScope)
  const choice = resolveUnityExplorerScopeChoice(options, saved, defaultScope)
  const { selectRoot, revealOutsideRoot } = useFileExplorerRootNavigation(
    worktreeId,
    choice,
    options
  )
  const revealOutsideScope = useCallback(
    (absolutePath: string) => {
      const containing =
        worktreePath &&
        options?.find(
          (option) =>
            getRelativePathInsideRoot(absolutePath, joinPath(worktreePath, option.value)) !== null
        )
      revealOutsideRoot(containing ? containing.value : FILE_EXPLORER_FULL_ROOT)
    },
    [options, revealOutsideRoot, worktreePath]
  )
  return {
    options,
    choice,
    treeRootPath: getExplorerDisplayRootPath(worktreePath, choice),
    selectScope: selectRoot,
    revealOutsideScope: choice === FILE_EXPLORER_FULL_ROOT ? undefined : revealOutsideScope
  }
}
