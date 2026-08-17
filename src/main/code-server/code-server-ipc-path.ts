import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { getCodeServerUserDataDir } from './code-server-paths'

// code-server's session registry socket (its --session-socket flag; default
// <user-data-dir>/code-server-ipc.sock). Windows can't listen on a filesystem
// path, so we pass a named pipe instead. The pipe namespace is machine-global —
// hash the user-data dir in so two Orca profiles never collide.
export function getCodeServerSessionSocketPath(
  platform: NodeJS.Platform = process.platform,
  userDataDir: string = getCodeServerUserDataDir()
): string {
  if (platform === 'win32') {
    const hash = createHash('sha1').update(userDataDir).digest('hex').slice(0, 12)
    return `\\\\.\\pipe\\orca-code-server-ipc-${hash}`
  }
  return join(userDataDir, 'code-server-ipc.sock')
}
