import { existsSync } from 'node:fs'
import { lstat, mkdir, readlink, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { getCodeServerUserDataDir } from './code-server-paths'
import { resolveEditorUserDir } from './code-server-import-sources'
import { readCodeServerImportPreference } from './code-server-import-preference'

// settings.json, keybindings.json and snippets are all mirrored verbatim via
// symlink: the embedded editor shares the source editor's real config, and
// edits made in either place flow straight back to the other. Regenerated on
// start. The source editor defaults to stable VS Code and can be switched via
// the import screen (persisted in the import preference).
const SYMLINKED_ENTRIES = ['settings.json', 'keybindings.json', 'snippets'] as const

// Idempotent; never blocks the editor from starting.
export async function mirrorEditorUserConfig(): Promise<void> {
  const preference = await readCodeServerImportPreference()
  const realUserDir = resolveEditorUserDir(preference.sourceId ?? 'vscode')
  if (!realUserDir) {
    return
  }
  const codeServerUserDir = join(getCodeServerUserDataDir(), 'User')
  try {
    await mkdir(codeServerUserDir, { recursive: true })
  } catch (error) {
    console.warn('[code-server] Could not create user dir for config:', error)
    return
  }

  for (const entry of SYMLINKED_ENTRIES) {
    await linkEntry(join(realUserDir, entry), join(codeServerUserDir, entry))
  }
}

async function linkEntry(target: string, linkPath: string): Promise<void> {
  if (!existsSync(target)) {
    return // never create a dangling symlink; code-server falls back to defaults
  }
  try {
    const current = await lstat(linkPath).catch(() => null)
    if (current?.isSymbolicLink()) {
      const existingTarget = await readlink(linkPath).catch(() => null)
      if (existingTarget === target) {
        return // already correct
      }
    } else if (current?.isDirectory()) {
      return // a real dir already lives here — do not clobber user data
    }
    // Replace a stale symlink (e.g. after switching source editors) or a
    // settings.json copy written by earlier Orca versions (which merged
    // settings into a copy instead of symlinking). Plain files/symlinks under
    // the code-server User dir are Orca-managed mirrors — the real editor
    // config is the source of truth — so removing one is safe.
    if (current) {
      await rm(linkPath, { force: true })
    }
    await symlink(target, linkPath)
  } catch (error) {
    // Permissions or a pre-existing file: log and continue with defaults.
    console.warn(`[code-server] Could not link ${target}:`, error)
  }
}
