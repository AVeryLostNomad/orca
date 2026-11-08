import { lstat } from 'node:fs/promises'
import { findUnityProjectRootFor } from '../../unity/unity-project-detect'
import { windowsFsPath } from '../../wsl/wsl-unc-drive-fs-path'
import { isENOENT } from './filesystem-path-containment'

const META_SUFFIX = '.meta'

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(windowsFsPath(path))
    return true
  } catch (error) {
    if (isENOENT(error)) {
      return false
    }
    throw error
  }
}

/** `<path>.meta` when it exists and `path` lies inside a Unity project; null otherwise. */
export async function findUnityMetaCompanion(path: string): Promise<string | null> {
  if (path.toLowerCase().endsWith(META_SUFFIX)) {
    return null
  }
  const metaPath = `${path}${META_SUFFIX}`
  if (!(await pathExists(metaPath))) {
    return null
  }
  return (await findUnityProjectRootFor(windowsFsPath(path))) ? metaPath : null
}

/** Unity pairs every asset with `<asset>.meta`; leaving it behind breaks GUID references. */
export async function renameWithUnityMetaCompanion(
  from: string,
  to: string,
  rename: (from: string, to: string) => Promise<void>
): Promise<void> {
  const metaPath = to.toLowerCase().endsWith(META_SUFFIX)
    ? null
    : await findUnityMetaCompanion(from)
  const targetMetaPath = `${to}${META_SUFFIX}`
  // Case-only renames see their own meta at the target on case-insensitive filesystems.
  if (
    metaPath &&
    metaPath.toLowerCase() !== targetMetaPath.toLowerCase() &&
    (await pathExists(targetMetaPath))
  ) {
    throw new Error(`'${targetMetaPath}' already exists; Unity would lose this asset's GUID.`)
  }
  await rename(from, to)
  if (!metaPath) {
    return
  }
  try {
    await rename(metaPath, targetMetaPath)
  } catch (error) {
    // Keep asset and meta together: undo the asset move rather than strand its GUID.
    await rename(to, from).catch(() => undefined)
    throw error
  }
}

/** Asset first: if the meta then fails, restoring the asset from Trash still finds its GUID. */
export async function deleteWithUnityMetaCompanion(
  target: string,
  deletePath: (path: string) => Promise<void>
): Promise<void> {
  const metaPath = await findUnityMetaCompanion(target)
  await deletePath(target)
  if (metaPath) {
    // Errors propagate so a Trash failure reaches the renderer's permanent-delete prompt.
    await deletePath(metaPath)
  }
}
