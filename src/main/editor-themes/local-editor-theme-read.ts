import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { parse as parseJsonc } from 'jsonc-parser'
import type {
  LocalEditorThemeReadRequest,
  MergedVSCodeTheme,
  VSCodeSemanticTokenStyle,
  VSCodeTokenColorSetting
} from '../../shared/editor-theme-types'
import type { CodeServerImportSourceId } from '../../shared/code-server-types'
import {
  CODE_SERVER_IMPORT_SOURCE_IDS,
  resolveEditorExtensionsDir,
  type EditorPathDeps
} from '../code-server/code-server-import-sources'

const MAX_INCLUDE_DEPTH = 5
const MAX_THEME_FILE_BYTES = 4 * 1024 * 1024

type RawVSCodeTheme = {
  name?: string
  type?: string
  include?: string
  colors?: Record<string, string>
  tokenColors?: VSCodeTokenColorSetting[] | string
  settings?: VSCodeTokenColorSetting[]
  semanticHighlighting?: boolean
  semanticTokenColors?: Record<string, VSCodeSemanticTokenStyle>
}

function assertContainedPath(candidate: string, containerDir: string): string {
  const resolved = resolve(candidate)
  if (resolved !== containerDir && !resolved.startsWith(containerDir + sep)) {
    throw new Error('Theme file path escapes the extension directory')
  }
  return resolved
}

async function readThemeFile(filePath: string): Promise<RawVSCodeTheme> {
  const raw = await readFile(filePath, 'utf-8')
  if (Buffer.byteLength(raw, 'utf-8') > MAX_THEME_FILE_BYTES) {
    throw new Error('Theme file is too large')
  }
  const parsed: unknown = parseJsonc(raw)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Theme file is not a JSON object')
  }
  return parsed as RawVSCodeTheme
}

function tokenColorsOf(theme: RawVSCodeTheme): VSCodeTokenColorSetting[] {
  // Old themes use `settings`; a string tokenColors points at a .tmTheme XML
  // file, which the JSON pipeline does not support.
  if (Array.isArray(theme.tokenColors)) {
    return theme.tokenColors
  }
  if (typeof theme.tokenColors === 'string') {
    throw new Error('tmTheme-based tokenColors are not supported')
  }
  return Array.isArray(theme.settings) ? theme.settings : []
}

// Flatten a theme's `include` chain: parent values load first so the child
// overrides colors and appends tokenColors, matching VS Code resolution.
async function loadThemeWithIncludes(
  filePath: string,
  containerDir: string,
  depth: number
): Promise<{
  colors: Record<string, string>
  tokenColors: VSCodeTokenColorSetting[]
  semanticTokenColors: Record<string, VSCodeSemanticTokenStyle>
  theme: RawVSCodeTheme
}> {
  if (depth > MAX_INCLUDE_DEPTH) {
    throw new Error('Theme include chain is too deep')
  }
  const theme = await readThemeFile(filePath)
  let colors: Record<string, string> = {}
  let tokenColors: VSCodeTokenColorSetting[] = []
  let semanticTokenColors: Record<string, VSCodeSemanticTokenStyle> = {}
  let parentTheme: RawVSCodeTheme | undefined
  if (typeof theme.include === 'string' && theme.include) {
    const includePath = assertContainedPath(join(dirname(filePath), theme.include), containerDir)
    const parent = await loadThemeWithIncludes(includePath, containerDir, depth + 1)
    colors = parent.colors
    tokenColors = parent.tokenColors
    semanticTokenColors = parent.semanticTokenColors
    parentTheme = parent.theme
  }
  colors = { ...colors, ...theme.colors }
  tokenColors = [...tokenColors, ...tokenColorsOf(theme)]
  semanticTokenColors = { ...semanticTokenColors, ...theme.semanticTokenColors }
  return {
    colors,
    tokenColors,
    semanticTokenColors,
    theme: {
      ...parentTheme,
      ...theme,
      type: theme.type ?? parentTheme?.type
    }
  }
}

function normalizeSourceId(sourceId: string): CodeServerImportSourceId {
  const match = CODE_SERVER_IMPORT_SOURCE_IDS.find((id) => id === sourceId)
  if (!match) {
    throw new Error(`Unknown editor theme source: ${sourceId}`)
  }
  return match
}

export async function readLocalEditorTheme(
  request: LocalEditorThemeReadRequest,
  deps: EditorPathDeps = {}
): Promise<MergedVSCodeTheme> {
  const sourceId = normalizeSourceId(request.sourceId)
  const extensionsDir = resolveEditorExtensionsDir(sourceId, deps)
  if (!extensionsDir) {
    throw new Error('Editor extensions directory is unavailable on this platform')
  }
  if (
    !request.extensionFolder ||
    request.extensionFolder.includes('/') ||
    request.extensionFolder.includes('\\') ||
    request.extensionFolder.startsWith('.')
  ) {
    throw new Error('Invalid extension folder name')
  }
  const extensionDir = join(extensionsDir, request.extensionFolder)
  const packageRaw = await readFile(join(extensionDir, 'package.json'), 'utf-8')
  const packageJson: unknown = JSON.parse(packageRaw)
  const contributions =
    typeof packageJson === 'object' && packageJson !== null
      ? ((packageJson as { contributes?: { themes?: unknown } }).contributes?.themes ?? [])
      : []
  if (!Array.isArray(contributions)) {
    throw new Error('Extension has no theme contributions')
  }
  const contribution = contributions.find(
    (entry: { label?: string; id?: string }) =>
      entry && (entry.label === request.label || entry.id === request.label)
  ) as { label?: string; uiTheme?: string; path?: string } | undefined
  if (!contribution?.path || isAbsolute(contribution.path)) {
    throw new Error(`Theme "${request.label}" not found in extension`)
  }

  const themePath = assertContainedPath(
    join(extensionDir, contribution.path),
    resolve(extensionDir)
  )
  const { colors, tokenColors, semanticTokenColors, theme } = await loadThemeWithIncludes(
    themePath,
    resolve(extensionDir),
    0
  )
  const type: 'light' | 'dark' =
    theme.type === 'light' || theme.type === 'dark'
      ? theme.type
      : contribution.uiTheme === 'vs' || contribution.uiTheme === 'hc-light'
        ? 'light'
        : 'dark'
  return {
    name: theme.name || request.label,
    type,
    colors,
    tokenColors,
    semanticHighlighting: theme.semanticHighlighting,
    semanticTokenColors
  }
}
