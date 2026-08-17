import { join } from 'node:path'
import { applyMachineSettings } from '../code-server/code-server-machine-settings'
import { getDataStudioProfileUserDataDir } from './data-studio-paths'

// Orca-owned defaults for the embedded Azure Data Studio workbench. SCM and
// terminal surfaces belong to Orca; ADS is here for its database views.
export const DATA_STUDIO_MACHINE_SETTINGS: Record<string, unknown> = {
  'git.enabled': false,
  'git.decorations.enabled': false,
  'scm.diffDecorations': 'none',
  'terminal.integrated.hideOnStartup': 'always',
  // No welcome tab — users land here for the database views, not an editor.
  'workbench.startupEditor': 'none',
  // The ADS gallery is retired; auto-update churn would only produce errors.
  'extensions.autoUpdate': false,
  'update.mode': 'none'
}

export async function applyDataStudioMachineSettings(repoId: string): Promise<void> {
  // The ADS/VS Code server keeps machine settings under
  // <server-data-dir>/data/Machine/settings.json (unlike coder/code-server's
  // <user-data-dir>/Machine).
  return applyMachineSettings(
    join(getDataStudioProfileUserDataDir(repoId), 'data'),
    DATA_STUDIO_MACHINE_SETTINGS
  )
}
