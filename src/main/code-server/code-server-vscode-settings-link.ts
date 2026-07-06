import { existsSync } from 'node:fs'
import { lstat, mkdir, readlink, symlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getCodeServerUserDataDir } from './code-server-paths'

// v1 targets stable "Code" only (Insiders / VSCodium are follow-ups).
function resolveRealVsCodeUserDir(): string | null {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Code', 'User')
  }
  if (process.platform === 'linux') {
    return join(homedir(), '.config', 'Code', 'User')
  }
  return null
}

const LINKED_ENTRIES = ['settings.json', 'keybindings.json', 'snippets'] as const

// Idempotent: (re)link each entry so edits in embedded VS Code write back to the
// user's real config (single source of truth). Never blocks the editor.
export async function linkVsCodeUserSettings(): Promise<void> {
  const realUserDir = resolveRealVsCodeUserDir()
  if (!realUserDir) {
    return
  }
  const codeServerUserDir = join(getCodeServerUserDataDir(), 'User')
  try {
    await mkdir(codeServerUserDir, { recursive: true })
  } catch (error) {
    console.warn('[code-server] Could not create user dir for settings link:', error)
    return
  }

  for (const entry of LINKED_ENTRIES) {
    const target = join(realUserDir, entry)
    if (!existsSync(target)) {
      continue // never create a dangling symlink; code-server falls back to defaults
    }
    const linkPath = join(codeServerUserDir, entry)
    try {
      const current = await lstat(linkPath).catch(() => null)
      if (current?.isSymbolicLink()) {
        const existingTarget = await readlink(linkPath).catch(() => null)
        if (existingTarget === target) {
          continue // already correct
        }
      }
      if (current) {
        continue // a real file/dir already lives here — do not clobber user data
      }
      await symlink(target, linkPath)
    } catch (error) {
      // Permissions or a pre-existing file: log and continue with defaults.
      console.warn(`[code-server] Could not link ${entry}:`, error)
    }
  }
}
