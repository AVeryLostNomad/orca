import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Pinned code-server release. Bump manually via PR; verify latest stable at
// https://github.com/coder/code-server/releases before changing.
export const CODE_SERVER_VERSION = '4.99.4'

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

// install.sh --prefix <root> installs to <root>/lib/code-server-<version>
// and symlinks <root>/bin/code-server.
export function resolveCodeServerExecutable(): string | null {
  const override = process.env.ORCA_CODE_SERVER_PATH
  if (override && existsSync(override)) {
    return override
  }
  const root = getCodeServerCacheRoot()
  const candidates = [
    join(root, 'lib', `code-server-${CODE_SERVER_VERSION}`, 'bin', 'code-server'),
    join(root, 'bin', 'code-server')
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

// Vendored copy of code-server's official install.sh, shipped via extraResources.
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
