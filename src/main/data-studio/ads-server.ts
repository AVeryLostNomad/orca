import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDataStudioRoot } from './data-studio-paths'

// Data Studio runs the REAL Azure Data Studio — the web server compiled from
// microsoft/azuredatastudio source (the repo kept upstream VS Code's
// `src/vs/server` + web workbench; Microsoft only stopped shipping it).
// Because ADS is retired and its source sits behind the Microsoft Source EULA,
// Orca never downloads prebuilt artifacts: the server is built on this machine
// by resources/data-studio/install-ads-server.sh into <userData>/data-studio/ads
// (override: ORCA_ADS_SERVER_ROOT). Layout expected by this module:
//   <root>/out/server-main.js        — compiled server entry
//   <root>/.build/node/<ver>/<platform>/node — the server Node runtime
//   <root>/extensions/…              — ADS builtin extensions (mssql, kusto, …)
//   <root>/node_modules/…            — runtime dependencies

export class AdsServerMissingError extends Error {
  constructor(detail: string) {
    super(
      `Azure Data Studio server is not installed (${detail}). ` +
        'Build it from Microsoft source with: resources/data-studio/install-ads-server.sh'
    )
  }
}

// The canonical install shared by every Orca instance on this machine. Dev
// builds redirect userData, but a ~5GB from-source ADS build should exist once,
// so instances whose own userData has no install fall back here.
function getSharedAdsServerRoot(): string | null {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Orca', 'data-studio', 'ads')
  }
  if (process.platform === 'linux') {
    return join(homedir(), '.config', 'Orca', 'data-studio', 'ads')
  }
  if (process.platform === 'win32' && process.env.APPDATA) {
    return join(process.env.APPDATA, 'Orca', 'data-studio', 'ads')
  }
  return null
}

export function getAdsServerRoot(): string {
  const override = process.env.ORCA_ADS_SERVER_ROOT
  if (override) {
    return override
  }
  const local = join(getDataStudioRoot(), 'ads')
  if (existsSync(join(local, 'out', 'server-main.js'))) {
    return local
  }
  const shared = getSharedAdsServerRoot()
  if (shared && existsSync(join(shared, 'out', 'server-main.js'))) {
    return shared
  }
  return local
}

export function resolveAdsServerEntry(): string | null {
  const entry = join(getAdsServerRoot(), 'out', 'server-main.js')
  return existsSync(entry) ? entry : null
}

// The remote-server Node runtime downloaded by ADS's own `gulp node` task.
// A real Node binary is required (never Electron-as-node): ADS's native
// modules are compiled against the Node ABI pinned in its .nvmrc.
export function resolveAdsNodeBinary(): string | null {
  const nodeRoot = join(getAdsServerRoot(), '.build', 'node')
  if (!existsSync(nodeRoot)) {
    return null
  }
  try {
    for (const version of readdirSync(nodeRoot)) {
      const versionDir = join(nodeRoot, version)
      for (const platform of readdirSync(versionDir)) {
        const candidate = join(
          versionDir,
          platform,
          process.platform === 'win32' ? 'node.exe' : 'node'
        )
        if (existsSync(candidate)) {
          return candidate
        }
      }
    }
  } catch {
    return null
  }
  return null
}

export function buildAdsServerSpawn(
  port: number,
  dirs: { userDataDir: string; extensionsDir: string; importDir?: string }
): { command: string; args: string[]; env: Record<string, string> } {
  const entry = resolveAdsServerEntry()
  if (!entry) {
    throw new AdsServerMissingError('out/server-main.js not found')
  }
  const node = resolveAdsNodeBinary()
  if (!node) {
    throw new AdsServerMissingError('server Node runtime not found under .build/node')
  }
  return {
    command: node,
    args: [
      entry,
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      // Loopback-only, same trust model as the embedded editor; the token
      // would otherwise have to be smuggled into every webview URL.
      '--without-connection-token',
      '--accept-server-license-terms',
      '--telemetry-level',
      'off',
      '--server-data-dir',
      dirs.userDataDir,
      '--extensions-dir',
      dirs.extensionsDir
    ],
    env: {
      // ADS never shipped a packaged web build ("SQL CARBON EDIT: turn off
      // web/remote build"), so the server runs the compiled source tree the
      // way ADS's own scripts/code-server.sh did: dev mode serves the web
      // workbench straight from out/.
      NODE_ENV: 'development',
      VSCODE_DEV: '1',
      // Desktop-ADS config staged for the patched /orca-import route.
      ...(dirs.importDir ? { ORCA_ADS_IMPORT_DIR: dirs.importDir } : {})
    }
  }
}
