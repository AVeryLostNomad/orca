import {
  isCaseInsensitiveRuntimeRoot,
  normalizeRuntimePathSeparators
} from '../../../../shared/cross-platform-path'

/** Preserve path case: sensitivity can differ per directory. Only local Windows clients interpret // as UNC. */
export function editorPathKey(filePath: string, windows: boolean): string {
  // Absolute POSIX paths start with `/`, so a drive or `\\` prefix proves Windows. `//` does not.
  const drive = /^[A-Za-z]:[\\/]/.test(filePath)
  const unc = filePath.startsWith('\\\\') || (windows && filePath.startsWith('//'))
  if (!drive && !unc) {
    return filePath
  }
  const slashed = normalizeRuntimePathSeparators(filePath)
  if (drive) {
    return `${slashed[0].toLowerCase()}${slashed.slice(1)}`
  }
  // The UNC server is a case-insensitive host name.
  const serverEnd = slashed.indexOf('/', 2)
  return serverEnd === -1
    ? slashed.toLowerCase()
    : `${slashed.slice(0, serverEnd).toLowerCase()}${slashed.slice(serverEnd)}`
}

/** Path key for matching external changes under a root: drive/`\\` roots fold, `//` and WSL stay byte-exact. */
export function externalChangePathKeyFor(rootPath: string): (filePath: string) => string {
  return isCaseInsensitiveRuntimeRoot(rootPath)
    ? (filePath) => editorPathKey(filePath, false)
    : (filePath) => filePath
}
