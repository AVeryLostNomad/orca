import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { authorizeExternalPath } from './filesystem-auth'

const SCRATCH_FILE_DIRNAME = 'scratch-files'

/** App-owned home for throwaway scratch editor files — outside every worktree
 *  so they never appear in git status, and deleted when their tab closes. */
export async function ensureScratchFileDirectory(): Promise<string> {
  const dir = path.join(app.getPath('userData'), SCRATCH_FILE_DIRNAME)
  await mkdir(dir, { recursive: true })
  // Why: like the floating workspace dir, authorize only this app-owned
  // directory instead of widening filesystem access beyond repo roots.
  authorizeExternalPath(dir)
  return dir
}
