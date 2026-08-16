import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getCodeServerUserDataDir } from './code-server-paths'

// Orca-owned defaults for the embedded editor, written to the server's
// machine-scope settings file (user-data/Machine/settings.json). Machine
// settings sit between VS Code's built-in defaults and user settings, so the
// user's own (symlinked) settings.json still wins per key. We deliberately do
// NOT write settings.json itself: it is symlinked to the user's real editor
// config. product.json configurationDefaults are not honored by code-server's
// workbench (verified empirically), which is why this file exists instead.
export const CODE_SERVER_MACHINE_SETTINGS: Record<string, unknown> = {
  // Orca owns source control; with the git extension disabled no SCM provider
  // registers and the Source Control view is an empty shell.
  'git.enabled': false,
  'git.decorations.enabled': false,
  'scm.diffDecorations': 'none',
  // Orca owns terminals. The integrated terminal can't be truly disabled by
  // any setting, so keep its panel from restoring on load.
  'terminal.integrated.hideOnStartup': 'always',
  // Orca owns agents; hide the Chat sidebar and command-center entry point.
  'chat.commandCenter.enabled': false,
  'chat.agent.enabled': false,
  'chat.disableAIFeatures': true,
  'workbench.secondarySideBar.defaultVisibility': 'hidden'
}

// Idempotent so it can run on every start; preserves keys the user may have
// added to the machine file by hand.
export async function applyCodeServerMachineSettings(): Promise<void> {
  const machineDir = join(getCodeServerUserDataDir(), 'Machine')
  const settingsPath = join(machineDir, 'settings.json')
  try {
    let existing: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(await readFile(settingsPath, 'utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>
      }
    } catch {
      // Missing or malformed file — rewrite it from the defaults.
    }
    const upToDate = Object.entries(CODE_SERVER_MACHINE_SETTINGS).every(
      ([key, value]) => existing[key] === value
    )
    if (upToDate) {
      return // avoid a needless write on every start
    }
    await mkdir(machineDir, { recursive: true })
    const merged = { ...existing, ...CODE_SERVER_MACHINE_SETTINGS }
    await writeFile(settingsPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
  } catch (error) {
    // An unwritable user-data dir shouldn't block the editor from starting —
    // the redundant VS Code surfaces simply stay visible.
    console.warn('[code-server] Could not apply machine settings:', error)
  }
}
