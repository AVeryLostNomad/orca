import { app } from 'electron'
import { join } from 'node:path'

// Layout under userData:
//   lsp/servers/<serverId>/<version>/   — installed server payloads
//   lsp/downloads/                      — staging for partial downloads/extracts
export function lspRootDir(): string {
  return join(app.getPath('userData'), 'lsp')
}

export function lspServerInstallDir(serverId: string, version: string): string {
  return join(lspRootDir(), 'servers', serverId, version)
}

export function lspDownloadStagingDir(): string {
  return join(lspRootDir(), 'downloads')
}
