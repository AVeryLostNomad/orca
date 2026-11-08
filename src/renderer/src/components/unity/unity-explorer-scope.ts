import { basename, getRelativePathInsideRoot, normalizeRelativePath } from '@/lib/path'
import {
  FILE_EXPLORER_FULL_ROOT,
  type ExplorerRootOption
} from '@/components/right-sidebar/file-explorer-display-root'
import type { GlobalSettings } from '../../../../shared/global-settings-types'

// Unity's Project window shows these two roots; everything else is editor/build output.
const UNITY_SCOPE_FOLDERS = ['Assets', 'Packages'] as const

/**
 * Explorer scopes for the Unity projects at or below a workspace (worktree-relative dirs,
 * `Game / Assets` labels when there are several), or null when the workspace has none.
 */
export function getUnityExplorerScopeOptions(
  projectRoots: readonly string[],
  worktreePath: string | null
): ExplorerRootOption[] | null {
  if (!worktreePath) {
    return null
  }
  const projects = projectRoots.flatMap((root) => {
    const relative = getRelativePathInsideRoot(root, worktreePath)
    return relative === null
      ? []
      : [{ root, relative: normalizeRelativePath(relative).replace(/\/+$/, '') }]
  })
  if (projects.length === 0) {
    return null
  }
  return projects.flatMap(({ root, relative }) =>
    UNITY_SCOPE_FOLDERS.map((folder) => ({
      value: relative ? `${relative}/${folder}` : folder,
      label: projects.length > 1 ? `${basename(root)} / ${folder}` : folder
    }))
  )
}

/** A saved scope wins while it still exists; otherwise the user's default (first Assets or whole folder). */
export function resolveUnityExplorerScopeChoice(
  options: readonly ExplorerRootOption[] | null,
  saved: string | undefined,
  defaultScope: GlobalSettings['unityExplorerDefaultScope']
): string {
  if (!options || options.length === 0) {
    return FILE_EXPLORER_FULL_ROOT
  }
  if (saved === FILE_EXPLORER_FULL_ROOT || options.some((option) => option.value === saved)) {
    return saved ?? FILE_EXPLORER_FULL_ROOT
  }
  return defaultScope === 'whole-folder' ? FILE_EXPLORER_FULL_ROOT : options[0].value
}
