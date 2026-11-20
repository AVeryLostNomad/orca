import type { TerminalCommandQuickCommand } from '../../../shared/terminal-quick-command-types'

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

export type PackageScriptQuickCommand = {
  command: TerminalCommandQuickCommand
  /** Worktree-relative path of the package.json the script came from. */
  packageJsonPath: string
}

const LOCKFILE_MANAGERS: Record<string, PackageManager> = {
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lockb': 'bun',
  'bun.lock': 'bun',
  'package-lock.json': 'npm'
}

/** Prefix shared by every synthesized package.json script command id. */
export const PACKAGE_SCRIPT_COMMAND_ID_PREFIX = 'pkg:'

function splitRelativePath(relativePath: string): {
  dir: string
  name: string
} {
  const normalized = relativePath.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  return slash === -1
    ? { dir: '', name: normalized }
    : { dir: normalized.slice(0, slash), name: normalized.slice(slash + 1) }
}

export function isPackageJsonPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/')
  if (splitRelativePath(normalized).name !== 'package.json') {
    return false
  }
  // Why: dependency manifests are not the user's scripts, even when node_modules is not ignored.
  return !normalized.split('/').some((segment) => segment === 'node_modules')
}

export function getLockfileManager(relativePath: string): PackageManager | null {
  const normalized = relativePath.replace(/\\/g, '/')
  if (normalized.split('/').some((segment) => segment === 'node_modules')) {
    return null
  }
  return LOCKFILE_MANAGERS[splitRelativePath(normalized).name] ?? null
}

/** Map each directory holding a lockfile to its package manager. */
export function buildLockfileManagerIndex(
  relativePaths: readonly string[]
): Map<string, PackageManager> {
  const index = new Map<string, PackageManager>()
  for (const relativePath of relativePaths) {
    const manager = getLockfileManager(relativePath)
    if (manager) {
      const { dir } = splitRelativePath(relativePath)
      // pnpm/yarn/bun win over a stray package-lock.json in the same folder.
      if (!index.has(dir) || index.get(dir) === 'npm') {
        index.set(dir, manager)
      }
    }
  }
  return index
}

function parsePackageManagerField(value: unknown): PackageManager | null {
  if (typeof value !== 'string') {
    return null
  }
  const name = value.split('@')[0]?.trim()
  return name === 'npm' || name === 'pnpm' || name === 'yarn' || name === 'bun' ? name : null
}

/** Nearest lockfile wins (walking up to the worktree root), then the manifest's packageManager. */
export function resolvePackageManager(
  packageDir: string,
  manifestPackageManager: unknown,
  lockfiles: ReadonlyMap<string, PackageManager>,
  rootPackageManager: PackageManager | null
): PackageManager {
  const declared = parsePackageManagerField(manifestPackageManager)
  if (declared) {
    return declared
  }
  let dir = packageDir
  while (true) {
    const manager = lockfiles.get(dir)
    if (manager) {
      return manager
    }
    if (!dir) {
      break
    }
    const slash = dir.lastIndexOf('/')
    dir = slash === -1 ? '' : dir.slice(0, slash)
  }
  return rootPackageManager ?? 'npm'
}

function quoteShellArg(value: string): string {
  // Double quotes are understood by PowerShell, cmd and POSIX shells alike.
  return /^[\w@:./+-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`
}

export function buildPackageScriptCommandLine(
  manager: PackageManager,
  packageDir: string,
  scriptName: string
): string {
  const script = quoteShellArg(scriptName)
  if (!packageDir) {
    return `${manager} run ${script}`
  }
  const dir = quoteShellArg(packageDir)
  switch (manager) {
    case 'npm':
      return `npm --prefix ${dir} run ${script}`
    case 'pnpm':
      return `pnpm --dir ${dir} run ${script}`
    case 'yarn':
      return `yarn --cwd ${dir} run ${script}`
    case 'bun':
      return `bun --cwd ${dir} run ${script}`
  }
}

export function getPackageJsonManifestPackageManager(content: string): PackageManager | null {
  try {
    const manifest = JSON.parse(content) as { packageManager?: unknown }
    return parsePackageManagerField(manifest?.packageManager)
  } catch {
    return null
  }
}

/** Turn one package.json's "scripts" block into run-in-tab quick commands. */
export function buildPackageScriptQuickCommands(args: {
  packageJsonPath: string
  content: string
  lockfiles: ReadonlyMap<string, PackageManager>
  rootPackageManager: PackageManager | null
}): PackageScriptQuickCommand[] {
  let manifest: { scripts?: unknown; packageManager?: unknown }
  try {
    manifest = JSON.parse(args.content) as typeof manifest
  } catch {
    return []
  }
  const scripts = manifest?.scripts
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
    return []
  }
  const packageJsonPath = args.packageJsonPath.replace(/\\/g, '/')
  const { dir } = splitRelativePath(packageJsonPath)
  const manager = resolvePackageManager(
    dir,
    manifest.packageManager,
    args.lockfiles,
    args.rootPackageManager
  )
  const result: PackageScriptQuickCommand[] = []
  for (const [scriptName, body] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof body !== 'string' || !scriptName.trim()) {
      continue
    }
    result.push({
      packageJsonPath,
      command: {
        id: `${PACKAGE_SCRIPT_COMMAND_ID_PREFIX}${packageJsonPath}#${scriptName}`,
        label: scriptName,
        action: 'terminal-command',
        command: buildPackageScriptCommandLine(manager, dir, scriptName),
        appendEnter: true,
        scope: { type: 'global' }
      }
    })
  }
  return result
}

/** Root package first, then shallower packages, then alphabetical. */
export function comparePackageJsonPaths(a: string, b: string): number {
  const depthA = a.split('/').length
  const depthB = b.split('/').length
  return depthA - depthB || a.localeCompare(b)
}
