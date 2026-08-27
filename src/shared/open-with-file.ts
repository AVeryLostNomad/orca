// Mirrors config/file-associations.cjs (packaging can't import TS) — a test asserts they match.
export const OPEN_WITH_FILE_EXTENSIONS = [
  'c',
  'cjs',
  'cpp',
  'cs',
  'css',
  'csv',
  'env',
  'go',
  'graphql',
  'h',
  'hpp',
  'html',
  'ini',
  'java',
  'js',
  'json',
  'jsonc',
  'jsx',
  'kt',
  'log',
  'md',
  'mjs',
  'prisma',
  'ps1',
  'py',
  'rb',
  'rs',
  'scss',
  'sh',
  'sql',
  'tf',
  'toml',
  'ts',
  'tsx',
  'txt',
  'xml',
  'yaml',
  'yml',
  'zsh'
] as const

const extensionSet = new Set<string>(OPEN_WITH_FILE_EXTENSIONS)

export function hasOpenWithFileExtension(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.')
  if (dot <= 0 || dot === filePath.length - 1) {
    return false
  }
  return extensionSet.has(filePath.slice(dot + 1).toLowerCase())
}

function isAbsoluteFilePath(arg: string): boolean {
  // Why: covers POSIX, Windows drive-letter, and UNC forms without importing node:path
  // (this module is shared with the renderer bundle).
  return arg.startsWith('/') || /^[A-Za-z]:[\\/]/.test(arg) || arg.startsWith('\\\\')
}

/**
 * Extracts OS "open with"-style file paths from process argv, filtering out
 * flags, URLs, and the executable/app-dir arguments packagers prepend.
 */
export function openWithFilePathsFromArguments(argv: readonly string[]): string[] {
  const paths: string[] = []
  for (const arg of argv) {
    if (!arg || arg.startsWith('-') || arg.includes('://')) {
      continue
    }
    if (!isAbsoluteFilePath(arg) || !hasOpenWithFileExtension(arg)) {
      continue
    }
    paths.push(arg)
  }
  return paths
}
