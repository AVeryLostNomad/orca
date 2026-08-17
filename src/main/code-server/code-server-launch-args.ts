import { getCodeServerExtensionsDir, getCodeServerUserDataDir } from './code-server-paths'
import { getCodeServerSessionSocketPath } from './code-server-ipc-path'

export function buildCodeServerArgs(
  port: number,
  platform: NodeJS.Platform = process.platform
): string[] {
  const args = [
    '--bind-addr',
    `127.0.0.1:${port}`,
    '--auth',
    'none',
    '--disable-telemetry',
    // The embedded editor only ever opens worktrees the user set up in Orca, so
    // Workspace Trust prompts are pure friction. Use code-server's native CLI
    // flag rather than product.json's configurationDefaults, which code-server's
    // server-side does not honor (verified: verifySignature=false there had no
    // effect). The flag applies per session, and we spawn fresh every time.
    '--disable-workspace-trust',
    '--user-data-dir',
    getCodeServerUserDataDir(),
    '--extensions-dir',
    getCodeServerExtensionsDir()
  ]
  if (platform === 'win32') {
    // The session socket defaults to a filesystem path under user-data-dir,
    // which Windows can't listen on — point it at a named pipe instead (the
    // same pipe code-server-open-file.ts connects to).
    args.push('--session-socket', getCodeServerSessionSocketPath(platform))
  }
  return args
}
