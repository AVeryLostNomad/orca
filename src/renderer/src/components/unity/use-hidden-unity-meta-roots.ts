import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { useUnityWorkspaceProjectRoots } from './unity-workbench-store'
import { isHiddenUnityMetaPath, toWorktreeRelativeUnityRoots } from './unity-meta-paths'

const NO_ROOTS: readonly string[] = []

/** Worktree-relative Unity roots whose `.meta` files listings should hide (empty when shown). */
export function useHiddenUnityMetaRoots(
  worktreeId: string | null | undefined,
  worktreePath: string | null | undefined
): readonly string[] {
  const hideMetaFiles = useAppStore((s) => s.settings?.unityHideMetaFiles !== false)
  const projectRoots = useUnityWorkspaceProjectRoots(worktreeId)
  return useMemo(() => {
    if (!hideMetaFiles || !worktreePath || projectRoots.length === 0) {
      return NO_ROOTS
    }
    return toWorktreeRelativeUnityRoots(projectRoots, worktreePath)
  }, [hideMetaFiles, projectRoots, worktreePath])
}

/** Worktree-relative `paths` without the `.meta` files hidden under Unity roots. */
export function useWithoutHiddenUnityMetaFiles(
  paths: string[],
  worktreeId: string | null | undefined,
  worktreePath: string | null | undefined
): string[] {
  const hiddenRoots = useHiddenUnityMetaRoots(worktreeId, worktreePath)
  return useMemo(
    () =>
      hiddenRoots.length === 0
        ? paths
        : paths.filter((path) => !isHiddenUnityMetaPath(path, hiddenRoots)),
    [hiddenRoots, paths]
  )
}
