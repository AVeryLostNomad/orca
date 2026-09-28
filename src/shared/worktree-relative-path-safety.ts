/** A worktree-relative path a client may name over the runtime wire: no roots, no `.`/`..` hops. */
export function isSafeWorktreeRelativePath(relativePath: string): boolean {
  if (!relativePath || relativePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(relativePath)) {
    return false
  }
  const parts = relativePath.replace(/\\/g, '/').split('/')
  return parts.every((part) => part !== '' && part !== '.' && part !== '..')
}
