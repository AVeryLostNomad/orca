import { app } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

// Pinned code-server release. Bump manually via PR; verify latest stable at
// https://github.com/coder/code-server/releases before changing. The Windows
// package pin in config/code-server-windows-package.json must be bumped in the
// same PR (a tripwire test asserts they agree).
export const CODE_SERVER_VERSION = '4.127.0'

export function getCodeServerCacheRoot(): string {
  return join(app.getPath('userData'), 'code-server')
}

export function getCodeServerUserDataDir(): string {
  return join(getCodeServerCacheRoot(), 'user-data')
}

export function getCodeServerExtensionsDir(): string {
  return join(getCodeServerCacheRoot(), 'extensions')
}

export function getCodeServerPidFilePath(): string {
  return join(getCodeServerCacheRoot(), 'code-server.pid')
}

// The self-contained versioned install dir. POSIX: created by install.sh
// (--prefix <cacheRoot> installs to lib/code-server-<version>). Windows: the
// CI-built package zip extracts to the same layout.
export function getCodeServerVersionRoot(): string {
  return join(getCodeServerCacheRoot(), 'lib', `code-server-${CODE_SERVER_VERSION}`)
}

export type CodeServerLaunch = {
  /** Executable to spawn. */
  command: string
  /** Args that precede the code-server CLI args (the JS entry on Windows). */
  args: string[]
  /** code-server-<version> dir when known; null for bare-file overrides. */
  root: string | null
}

// The Windows package has no bin/ wrapper: launch the bundled Node against
// code-server's entry module directly — exactly what the POSIX bin/code-server
// shell wrapper does — so no .cmd shim and no cmd.exe quoting is ever involved.
function resolveNodeEntryLaunch(root: string, platform: NodeJS.Platform): CodeServerLaunch | null {
  const node = join(root, 'lib', platform === 'win32' ? 'node.exe' : 'node')
  const entry = join(root, 'out', 'node', 'entry.js')
  if (existsSync(node) && existsSync(entry)) {
    return { command: node, args: [entry], root }
  }
  return null
}

// How to spawn the installed code-server, or null when not installed.
// ORCA_CODE_SERVER_PATH accepts either a launcher file (back-compat) or an
// unpacked package directory (dev/e2e escape hatch — starts with no download).
export function resolveCodeServerLaunch(
  platform: NodeJS.Platform = process.platform
): CodeServerLaunch | null {
  const override = process.env.ORCA_CODE_SERVER_PATH
  if (override && existsSync(override)) {
    if (statSync(override, { throwIfNoEntry: false })?.isDirectory()) {
      const posixBin = join(override, 'bin', 'code-server')
      return (
        resolveNodeEntryLaunch(override, platform) ??
        (existsSync(posixBin) ? { command: posixBin, args: [], root: override } : null)
      )
    }
    return { command: override, args: [], root: null }
  }
  const versionRoot = getCodeServerVersionRoot()
  if (platform === 'win32') {
    return resolveNodeEntryLaunch(versionRoot, platform)
  }
  const versionedBin = join(versionRoot, 'bin', 'code-server')
  if (existsSync(versionedBin)) {
    return { command: versionedBin, args: [], root: versionRoot }
  }
  // install.sh also symlinks <prefix>/bin/code-server; keep it as a fallback.
  const prefixBin = join(getCodeServerCacheRoot(), 'bin', 'code-server')
  if (existsSync(prefixBin)) {
    return { command: prefixBin, args: [], root: null }
  }
  return null
}

// code-server's bundled VS Code product.json (…/code-server-<version>/lib/
// vscode/product.json). Used to apply distribution-scoped configuration
// defaults to the embedded editor without touching the user's real settings.
export function resolveCodeServerProductJson(): string | null {
  const launch = resolveCodeServerLaunch()
  if (!launch) {
    return null
  }
  // Bare-file overrides carry no version root; assume the POSIX bin/ layout.
  const productJson = launch.root
    ? join(launch.root, 'lib', 'vscode', 'product.json')
    : join(dirname(launch.command), '..', 'lib', 'vscode', 'product.json')
  return existsSync(productJson) ? productJson : null
}

// Vendored copy of code-server's official install.sh, shipped via extraResources
// on mac/linux only — Windows installs from the CI-built package instead.
export function resolveCodeServerInstallScript(): string | null {
  const override = process.env.ORCA_CODE_SERVER_INSTALL_SCRIPT
  if (override && existsSync(override)) {
    return override
  }
  const packaged = [join(process.resourcesPath ?? '', 'code-server', 'install.sh')]
  const dev = [
    join(process.cwd(), 'resources/code-server/install.sh'),
    resolve(__dirname, '../../resources/code-server/install.sh')
  ]
  const candidates = process.resourcesPath ? [...packaged, ...dev] : dev
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null
}
