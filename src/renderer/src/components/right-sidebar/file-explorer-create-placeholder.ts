/** Existence probe over the tree model; accepts worktree-relative paths without trailing slash. */
export type CreatePlaceholderExistsProbe = (relativePath: string) => boolean

const CREATE_PLACEHOLDER_BASE_NAME = 'untitled'
const CREATE_PLACEHOLDER_MAX_ATTEMPTS = 1000

/**
 * Collision-free placeholder name for the create-via-rename flow.
 * Returns a worktree-relative path (no trailing slash) inside parentRelativeDir.
 */
export function getCreatePlaceholderRelativePath(
  parentRelativeDir: string,
  exists: CreatePlaceholderExistsProbe
): string | null {
  const prefix = parentRelativeDir ? `${parentRelativeDir}/` : ''
  for (let attempt = 0; attempt < CREATE_PLACEHOLDER_MAX_ATTEMPTS; attempt += 1) {
    const name =
      attempt === 0
        ? CREATE_PLACEHOLDER_BASE_NAME
        : `${CREATE_PLACEHOLDER_BASE_NAME}-${attempt + 1}`
    const candidate = `${prefix}${name}`
    if (!exists(candidate)) {
      return candidate
    }
  }
  return null
}
