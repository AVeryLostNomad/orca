import { join } from 'node:path'
import { app } from 'electron'
import { hashWorktreeId } from './terminal-history-paths'

const WORKSPACE_NOTES_DIR_NAME = 'workspace-notes'
export const WORKSPACE_NOTES_FILE_NAME = 'notes.md'

export function getWorkspaceNotesRoot(): string {
  return join(app.getPath('userData'), WORKSPACE_NOTES_DIR_NAME)
}

/** Per-workspace notes dir, keyed like terminal history: sha256(workspaceId) prefix. */
export function getWorkspaceNotesDir(workspaceId: string): string {
  return join(getWorkspaceNotesRoot(), hashWorktreeId(workspaceId))
}

export function getWorkspaceNotesFilePath(workspaceId: string): string {
  return join(getWorkspaceNotesDir(workspaceId), WORKSPACE_NOTES_FILE_NAME)
}
