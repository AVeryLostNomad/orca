import { existsSync } from 'node:fs'
import { copyFile, lstat, mkdir, readlink, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { getCodeServerUserDataDir } from './code-server-paths'
import { resolveEditorUserDir } from './code-server-import-sources'
import { readCodeServerImportPreference } from './code-server-import-preference'

// settings.json, keybindings.json and snippets are all mirrored verbatim via
// symlink: the embedded editor shares the source editor's real config, and
// edits made in either place flow straight back to the other. Regenerated on
// start. The source editor defaults to stable VS Code and can be switched via
// the import screen (persisted in the import preference).
//
// Windows: the snippets dir uses a junction (unprivileged); the file entries
// try a symlink and fall back to a copy when file symlinks need Developer
// Mode/elevation (EPERM). Copies are one-way mirrors, re-copied on every
// server start so they track the source editor.
const MIRRORED_ENTRIES = [
  { name: 'settings.json', kind: 'file' },
  { name: 'keybindings.json', kind: 'file' },
  { name: 'snippets', kind: 'dir' }
] as const

type MirrorDeps = { platform?: NodeJS.Platform }

// Idempotent; never blocks the editor from starting.
export async function mirrorEditorUserConfig(deps: MirrorDeps = {}): Promise<void> {
  const platform = deps.platform ?? process.platform
  const preference = await readCodeServerImportPreference()
  const realUserDir = resolveEditorUserDir(preference.sourceId ?? 'vscode', { platform })
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

  for (const entry of MIRRORED_ENTRIES) {
    await linkEntry(
      join(realUserDir, entry.name),
      join(codeServerUserDir, entry.name),
      entry.kind,
      platform
    )
  }
}

async function linkEntry(
  target: string,
  linkPath: string,
  kind: 'file' | 'dir',
  platform: NodeJS.Platform
): Promise<void> {
  if (!existsSync(target)) {
    return // never create a dangling symlink; code-server falls back to defaults
  }
  try {
    const current = await lstat(linkPath).catch(() => null)
    if (current?.isSymbolicLink()) {
      const existingTarget = await readlink(linkPath).catch(() => null)
      if (existingTarget && symlinkTargetsMatch(existingTarget, target, platform)) {
        return // already correct (junctions read back with \\?\ prefixes; see matcher)
      }
    } else if (current?.isDirectory()) {
      return // a real dir already lives here — do not clobber user data
    }
    // Replace a stale symlink (e.g. after switching source editors) or a plain
    // file (an earlier run's copy fallback, or older Orca versions' merged
    // settings copy). Plain files/symlinks under the code-server User dir are
    // Orca-managed mirrors — the real editor config is the source of truth —
    // so removing one is safe. This is also what keeps copy-mode mirrors fresh
    // (re-copied each start) and lets a copy upgrade to a symlink once file
    // symlinks become possible (Developer Mode).
    if (current) {
      await rm(linkPath, { force: true })
    }
    if (kind === 'dir' && platform === 'win32') {
      // Directory junctions are unprivileged on Windows; file symlinks are not.
      await symlink(target, linkPath, 'junction')
      return
    }
    try {
      await symlink(target, linkPath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      if (kind === 'file' && platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) {
        await copyFile(target, linkPath)
        return
      }
      throw error
    }
  } catch (error) {
    // Permissions or a pre-existing file: log and continue with defaults.
    console.warn(`[code-server] Could not link ${target}:`, error)
  }
}

// Windows readlink can return junction targets in \\?\C:\... form with a
// trailing separator and arbitrary case; normalize both sides so a correct
// junction isn't torn down and re-created on every server start.
function symlinkTargetsMatch(existing: string, target: string, platform: NodeJS.Platform): boolean {
  if (platform !== 'win32') {
    return existing === target
  }
  return normalizeWindowsLinkTarget(existing) === normalizeWindowsLinkTarget(target)
}

function normalizeWindowsLinkTarget(value: string): string {
  return value
    .replace(/^\\\\\?\\/, '')
    .replace(/[\\/]+$/, '')
    .toLowerCase()
}
