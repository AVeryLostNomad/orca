import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LocalEditorThemeDescriptor } from '../../shared/editor-theme-types'
import type { CodeServerImportSourceId } from '../../shared/code-server-types'
import {
  CODE_SERVER_IMPORT_SOURCE_IDS,
  isExtensionFolderName,
  resolveEditorExtensionsDir,
  type EditorPathDeps
} from '../code-server/code-server-import-sources'

const SOURCE_NAMES: Record<CodeServerImportSourceId, string> = {
  vscode: 'VS Code',
  'vscode-insiders': 'VS Code Insiders',
  vscodium: 'VSCodium',
  cursor: 'Cursor'
}

type ExtensionThemeContribution = {
  label?: string
  id?: string
  uiTheme?: string
  path?: string
}

type ExtensionPackageJson = {
  displayName?: string
  name?: string
  contributes?: { themes?: ExtensionThemeContribution[] }
}

async function readExtensionPackage(
  extensionDir: string
): Promise<ExtensionPackageJson | undefined> {
  try {
    const raw = await readFile(join(extensionDir, 'package.json'), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as ExtensionPackageJson)
      : undefined
  } catch {
    return undefined
  }
}

async function scanSourceThemes(
  sourceId: CodeServerImportSourceId,
  deps: EditorPathDeps
): Promise<LocalEditorThemeDescriptor[]> {
  const extensionsDir = resolveEditorExtensionsDir(sourceId, deps)
  if (!extensionsDir) {
    return []
  }
  let entries
  try {
    entries = await readdir(extensionsDir, { withFileTypes: true })
  } catch {
    return []
  }
  const themes: LocalEditorThemeDescriptor[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !isExtensionFolderName(entry.name)) {
      continue
    }
    const packageJson = await readExtensionPackage(join(extensionsDir, entry.name))
    const contributions = packageJson?.contributes?.themes
    if (!Array.isArray(contributions)) {
      continue
    }
    for (const contribution of contributions) {
      const label = contribution.label || contribution.id
      if (!label || !contribution.path) {
        continue
      }
      // .tmTheme XML themes predate the JSON format and are not supported.
      if (contribution.path.endsWith('.tmTheme')) {
        continue
      }
      themes.push({
        sourceId,
        sourceName: SOURCE_NAMES[sourceId],
        extensionFolder: entry.name,
        extensionDisplayName: packageJson?.displayName || packageJson?.name || entry.name,
        label,
        uiTheme: contribution.uiTheme || 'vs-dark'
      })
    }
  }
  return themes
}

export async function scanLocalEditorThemes(
  deps: EditorPathDeps = {}
): Promise<LocalEditorThemeDescriptor[]> {
  const results = await Promise.all(
    CODE_SERVER_IMPORT_SOURCE_IDS.map((sourceId) => scanSourceThemes(sourceId, deps))
  )
  return results.flat()
}
