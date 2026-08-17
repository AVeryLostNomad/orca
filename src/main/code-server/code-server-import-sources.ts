import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  CodeServerImportSource,
  CodeServerImportSourceId
} from '../../shared/code-server-types'

type EditorLocation = {
  name: string
  /** Directory name under the platform config root (e.g. "Code - Insiders"). */
  configDirName: string
  /** Home-relative extensions dir (e.g. ".vscode/extensions"). */
  extensionsDirName: string
}

const EDITOR_LOCATIONS: Record<CodeServerImportSourceId, EditorLocation> = {
  vscode: { name: 'VS Code', configDirName: 'Code', extensionsDirName: '.vscode' },
  'vscode-insiders': {
    name: 'VS Code Insiders',
    configDirName: 'Code - Insiders',
    extensionsDirName: '.vscode-insiders'
  },
  vscodium: { name: 'VSCodium', configDirName: 'VSCodium', extensionsDirName: '.vscode-oss' },
  cursor: { name: 'Cursor', configDirName: 'Cursor', extensionsDirName: '.cursor' }
}

export const CODE_SERVER_IMPORT_SOURCE_IDS = Object.keys(
  EDITOR_LOCATIONS
) as CodeServerImportSourceId[]

export type EditorPathDeps = {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  homeDir?: string
}

export function resolveEditorUserDir(
  id: CodeServerImportSourceId,
  deps: EditorPathDeps = {}
): string | null {
  const platform = deps.platform ?? process.platform
  const home = deps.homeDir ?? homedir()
  const { configDirName } = EDITOR_LOCATIONS[id]
  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', configDirName, 'User')
  }
  if (platform === 'linux') {
    return join(home, '.config', configDirName, 'User')
  }
  if (platform === 'win32') {
    // All four editors keep their User dir under %APPDATA% with the same
    // configDirName as on mac/linux (e.g. %APPDATA%\Code\User).
    const appData = (deps.env ?? process.env).APPDATA
    return join(appData || join(home, 'AppData', 'Roaming'), configDirName, 'User')
  }
  return null
}

export function resolveEditorExtensionsDir(
  id: CodeServerImportSourceId,
  deps: EditorPathDeps = {}
): string | null {
  const platform = deps.platform ?? process.platform
  if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') {
    return null
  }
  // Home-relative on every supported platform (%USERPROFILE%\.vscode\extensions
  // on Windows).
  return join(deps.homeDir ?? homedir(), EDITOR_LOCATIONS[id].extensionsDirName, 'extensions')
}

// Folders in an extensions dir are `publisher.name-version[-platform]`; anything
// else (extensions.json, .obsolete, .DS_Store) is bookkeeping, not an extension.
export function isExtensionFolderName(name: string): boolean {
  return !name.startsWith('.') && name !== 'extensions.json' && name.includes('.')
}

async function countExtensions(extensionsDir: string | null): Promise<number> {
  if (!extensionsDir || !existsSync(extensionsDir)) {
    return 0
  }
  try {
    const entries = await readdir(extensionsDir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory() && isExtensionFolderName(e.name)).length
  } catch {
    return 0
  }
}

// Detect installed editors whose config can be adopted. Only editors with at
// least some importable config are returned.
export async function detectCodeServerImportSources(): Promise<CodeServerImportSource[]> {
  const sources: CodeServerImportSource[] = []
  for (const id of CODE_SERVER_IMPORT_SOURCE_IDS) {
    const userDir = resolveEditorUserDir(id)
    if (!userDir) {
      continue
    }
    const hasSettings = existsSync(join(userDir, 'settings.json'))
    const hasKeybindings = existsSync(join(userDir, 'keybindings.json'))
    const hasSnippets = existsSync(join(userDir, 'snippets'))
    const extensionCount = await countExtensions(resolveEditorExtensionsDir(id))
    if (hasSettings || hasKeybindings || hasSnippets || extensionCount > 0) {
      sources.push({
        id,
        name: EDITOR_LOCATIONS[id].name,
        hasSettings,
        hasKeybindings,
        hasSnippets,
        extensionCount
      })
    }
  }
  return sources
}
