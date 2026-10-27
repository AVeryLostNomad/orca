import { getPtyIpc } from '../pty-host-bindings'
import type { OrcaRuntimeService } from '../../../runtime/orca-runtime'

/** Durably records an explicit desktop tab close even when the daemon owning its PTY misses the kill. */
export function installPtyRetireTabIpcHandler(runtime: OrcaRuntimeService | undefined): void {
  const ipcMain = getPtyIpc()
  ipcMain.removeHandler('pty:retireTab')
  ipcMain.handle(
    'pty:retireTab',
    async (_event, args: { worktreeId?: string; tabId?: string }): Promise<void> => {
      if (!args?.worktreeId || !args?.tabId) {
        throw new Error('Invalid terminal tab retirement')
      }
      if (!runtime) {
        throw new Error('runtime_unavailable')
      }
      await runtime.retireDesktopTerminalTab(args.worktreeId, args.tabId)
    }
  )
}
