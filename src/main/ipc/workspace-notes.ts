import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import type {
  WorkspaceNotesEnsureRequest,
  WorkspaceNotesEnsureResult
} from '../../shared/workspace-notes-types'
import {
  getWorkspaceNotesDir,
  getWorkspaceNotesFilePath,
  getWorkspaceNotesRoot
} from '../workspace-notes-paths'
import { authorizeExternalPath } from './filesystem-auth'

function isEEXIST(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'EEXIST'
}

/** Write once with `wx`; an existing file (user content, concurrent create) is never overwritten. */
async function writeIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await writeFile(filePath, content, { encoding: 'utf-8', flag: 'wx' })
  } catch (error) {
    if (!isEEXIST(error)) {
      throw error
    }
  }
}

export async function ensureWorkspaceNotesFile(
  request: WorkspaceNotesEnsureRequest
): Promise<WorkspaceNotesEnsureResult> {
  const { workspaceId, displayName } = request
  if (!workspaceId) {
    throw new Error('workspaceId is required')
  }
  // Session-scoped grant; the root lives under userData, outside every repo/workspace allowed root.
  authorizeExternalPath(getWorkspaceNotesRoot())
  const dir = getWorkspaceNotesDir(workspaceId)
  await mkdir(dir, { recursive: true })
  // meta.json records ownership so GC can reverse the hashed dir name.
  await writeIfMissing(
    join(dir, 'meta.json'),
    JSON.stringify({ worktreeId: workspaceId, createdAt: new Date().toISOString() }, null, 2)
  )
  const filePath = getWorkspaceNotesFilePath(workspaceId)
  await writeIfMissing(filePath, `# Notes for ${displayName}\n-`)
  return { filePath }
}

export function registerWorkspaceNotesHandlers(): void {
  ipcMain.handle('workspaceNotes:ensureFile', (_event, request: WorkspaceNotesEnsureRequest) =>
    ensureWorkspaceNotesFile(request)
  )
}
