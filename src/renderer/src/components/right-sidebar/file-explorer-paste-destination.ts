import { dirname } from '@/lib/path'
import { isPathEqualOrDescendant } from './file-explorer-paths'

/**
 * Directory copied entries should land in, or null when a copied folder would be pasted
 * into its own subtree (the recursive copy would keep re-reading what it just wrote).
 * A lone folder pasted onto itself lands beside itself, as Duplicate does.
 */
export function resolveFileExplorerPasteDestination(
  sourcePaths: readonly string[],
  targetDir: string
): string | null {
  if (!sourcePaths.some((source) => isPathEqualOrDescendant(targetDir, source))) {
    return targetDir
  }
  return sourcePaths.length === 1 && isPathEqualOrDescendant(sourcePaths[0], targetDir)
    ? dirname(targetDir)
    : null
}
