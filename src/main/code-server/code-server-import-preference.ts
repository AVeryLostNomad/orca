import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CodeServerImportSourceId } from '../../shared/code-server-types'
import { getCodeServerCacheRoot } from './code-server-paths'
import { CODE_SERVER_IMPORT_SOURCE_IDS } from './code-server-import-sources'

export type CodeServerImportPreference = {
  /** Editor whose user config is mirrored into the embedded editor. */
  sourceId?: CodeServerImportSourceId
  /** Set when the user closed the first-run import prompt without importing. */
  promptDismissed?: boolean
}

function getPreferencePath(): string {
  return join(getCodeServerCacheRoot(), 'config-import.json')
}

export async function readCodeServerImportPreference(): Promise<CodeServerImportPreference> {
  const path = getPreferencePath()
  if (!existsSync(path)) {
    return {}
  }
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as CodeServerImportPreference
    const sourceId = CODE_SERVER_IMPORT_SOURCE_IDS.includes(
      parsed.sourceId as CodeServerImportSourceId
    )
      ? parsed.sourceId
      : undefined
    return { sourceId, promptDismissed: parsed.promptDismissed === true }
  } catch {
    return {} // unreadable preference falls back to the stable VS Code default
  }
}

export async function updateCodeServerImportPreference(
  updates: CodeServerImportPreference
): Promise<void> {
  const current = await readCodeServerImportPreference()
  const next = { ...current, ...updates }
  try {
    await mkdir(getCodeServerCacheRoot(), { recursive: true })
    await writeFile(getPreferencePath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  } catch (error) {
    console.warn('[code-server] Could not persist import preference:', error)
  }
}
