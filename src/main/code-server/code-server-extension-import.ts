import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CodeServerImportSourceId } from '../../shared/code-server-types'
import { getCodeServerExtensionsDir } from './code-server-paths'
import { isExtensionFolderName, resolveEditorExtensionsDir } from './code-server-import-sources'

// Shape of entries in an extensions dir's extensions.json (VS Code's installed-
// extensions metadata). Unknown fields are preserved verbatim.
export type ExtensionsMetadataEntry = {
  identifier: { id: string; uuid?: string }
  version?: string
  location?: { $mid?: number; path: string; scheme: string }
  relativeLocation?: string
  metadata?: Record<string, unknown>
} & Record<string, unknown>

// Folder names are `publisher.name-version[-platform]`; the id is everything
// before the first `-<digit>` version boundary.
export function extensionIdFromFolderName(folderName: string): string {
  const match = /^(.+?)-\d+\.\d+\.\d+/.exec(folderName)
  return (match?.[1] ?? folderName).toLowerCase()
}

// Replace-by-id merge: an imported extension supersedes any existing entry for
// the same id (case-insensitive, as VS Code treats ids), everything else kept.
export function mergeExtensionsMetadata(
  existing: ExtensionsMetadataEntry[],
  incoming: ExtensionsMetadataEntry[]
): ExtensionsMetadataEntry[] {
  const incomingIds = new Set(incoming.map((e) => e.identifier.id.toLowerCase()))
  return [...existing.filter((e) => !incomingIds.has(e.identifier.id.toLowerCase())), ...incoming]
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  if (!existsSync(path)) {
    return fallback
  }
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

async function listExtensionFolders(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.filter((e) => e.isDirectory() && isExtensionFolderName(e.name)).map((e) => e.name)
}

// Recent VS Code treats extensions.json as authoritative, so a copied folder
// with no metadata entry would be ignored (or garbage-collected). Synthesize a
// minimal entry from the extension's own manifest when the source had none.
async function synthesizeEntry(
  sourceDir: string,
  folderName: string
): Promise<ExtensionsMetadataEntry | null> {
  const manifest = await readJsonFile<{ publisher?: string; name?: string; version?: string }>(
    join(sourceDir, folderName, 'package.json'),
    {}
  )
  if (!manifest.publisher || !manifest.name) {
    return null
  }
  return {
    identifier: { id: `${manifest.publisher}.${manifest.name}` },
    version: manifest.version,
    relativeLocation: folderName
  }
}

export type ExtensionImportSummary = { imported: number; skipped: number }

// Copy the source editor's extensions into the embedded editor's extensions
// dir. Extensions already present (any version) are left untouched — the
// embedded editor may have newer installs the user made there directly.
export async function importExtensionsFromEditor(
  sourceId: CodeServerImportSourceId
): Promise<ExtensionImportSummary> {
  const sourceDir = resolveEditorExtensionsDir(sourceId)
  if (!sourceDir || !existsSync(sourceDir)) {
    return { imported: 0, skipped: 0 }
  }
  const targetDir = getCodeServerExtensionsDir()
  await mkdir(targetDir, { recursive: true })

  // .obsolete marks uninstalled-but-not-yet-deleted folders in the source.
  const obsolete = await readJsonFile<Record<string, boolean>>(join(sourceDir, '.obsolete'), {})
  const sourceMetadata = await readJsonFile<ExtensionsMetadataEntry[]>(
    join(sourceDir, 'extensions.json'),
    []
  )
  const metadataByFolder = new Map(
    sourceMetadata.filter((e) => e.relativeLocation).map((e) => [e.relativeLocation, e])
  )
  const installedIds = new Set(
    (existsSync(targetDir) ? await listExtensionFolders(targetDir) : []).map(
      extensionIdFromFolderName
    )
  )

  let imported = 0
  let skipped = 0
  const importedEntries: ExtensionsMetadataEntry[] = []
  for (const folderName of await listExtensionFolders(sourceDir)) {
    if (obsolete[folderName]) {
      continue
    }
    if (installedIds.has(extensionIdFromFolderName(folderName))) {
      skipped += 1
      continue
    }
    const entry = metadataByFolder.get(folderName) ?? (await synthesizeEntry(sourceDir, folderName))
    if (!entry) {
      skipped += 1 // not a readable extension folder
      continue
    }
    await cp(join(sourceDir, folderName), join(targetDir, folderName), { recursive: true })
    importedEntries.push({
      ...entry,
      location: { $mid: 1, path: join(targetDir, folderName), scheme: 'file' },
      relativeLocation: folderName
    })
    imported += 1
  }

  if (importedEntries.length > 0) {
    const targetMetadataPath = join(targetDir, 'extensions.json')
    const existing = await readJsonFile<ExtensionsMetadataEntry[]>(targetMetadataPath, [])
    const merged = mergeExtensionsMetadata(existing, importedEntries)
    await writeFile(targetMetadataPath, JSON.stringify(merged), 'utf8')
  }
  return { imported, skipped }
}
