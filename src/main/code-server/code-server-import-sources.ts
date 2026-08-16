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

// The embedded editor is darwin/linux-only in v1, so Windows returns null.
export function resolveEditorUserDir(id: CodeServerImportSourceId): string | null {
  const { configDirName } = EDITOR_LOCATIONS[id]
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', configDirName, 'User')
  }
  if (process.platform === 'linux') {
    return join(homedir(), '.config', configDirName, 'User')
  }
  return null
}

export function resolveEditorExtensionsDir(id: CodeServerImportSourceId): string | null {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    return null
  }
  return join(homedir(), EDITOR_LOCATIONS[id].extensionsDirName, 'extensions')
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
