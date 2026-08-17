import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDataStudioProfileDir } from './data-studio-paths'

// First-run import of the user's desktop Azure Data Studio configuration.
// The staged files are served by the patched ADS web server at
// /orca-import/*, and the workbench html seeds them into the webview's
// user-data store ONLY when absent — so the import happens once per repo
// partition and never clobbers web-side edits. Desktop settings.json carries
// datasource.connections/connectionGroups, so this migrates the user's whole
// connection tree (passwords stay in the desktop keychain and don't carry).

const IMPORT_FILES = ['settings.json', 'keybindings.json'] as const

export function resolveDesktopAdsUserDir(): string | null {
  const candidates =
    process.platform === 'darwin'
      ? [join(homedir(), 'Library', 'Application Support', 'azuredatastudio', 'User')]
      : process.platform === 'linux'
        ? [join(homedir(), '.config', 'azuredatastudio', 'User')]
        : process.platform === 'win32' && process.env.APPDATA
          ? [join(process.env.APPDATA, 'azuredatastudio', 'User')]
          : []
  return candidates.find((dir) => existsSync(dir)) ?? null
}

export function getAdsImportDir(repoId: string): string {
  return join(getDataStudioProfileDir(repoId), 'ads-import')
}

/** Stage a fresh copy of the desktop ADS config for this repo's server.
 *  Re-staged on every start so first-runs of NEW workspaces see current
 *  desktop config; already-seeded partitions are unaffected by design. */
export function stageAdsDesktopImport(repoId: string): void {
  const sourceDir = resolveDesktopAdsUserDir()
  if (!sourceDir) {
    return // no desktop ADS on this machine — the server 404s and seeding no-ops
  }
  const importDir = getAdsImportDir(repoId)
  try {
    mkdirSync(importDir, { recursive: true })
    for (const file of IMPORT_FILES) {
      const source = join(sourceDir, file)
      if (existsSync(source)) {
        copyFileSync(source, join(importDir, file))
      }
    }
  } catch (error) {
    console.warn('[data-studio] Could not stage desktop ADS config import:', error)
  }
}
