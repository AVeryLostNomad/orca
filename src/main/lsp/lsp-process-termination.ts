import type { ChildProcess } from 'node:child_process'
import { terminateWindowsProcessTree } from '../windows-process-tree-kill'

const SIGKILL_GRACE_MS = 1500

/** Kill a language server and its descendants (tsserver, clangd workers…).
 *  Windows needs the tree kill — plain kill() would orphan child servers. */
export async function killProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid
  if (!pid || child.exitCode !== null) {
    return
  }
  if (process.platform === 'win32') {
    await terminateWindowsProcessTree(pid)
    return
  }
  child.kill('SIGTERM')
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL')
      }
      resolve()
    }, SIGKILL_GRACE_MS)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}
