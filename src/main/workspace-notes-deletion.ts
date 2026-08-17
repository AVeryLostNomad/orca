import { join } from 'node:path'
import {
  schedulePendingHistoryTreeRemovals,
  scheduleWorktreeHistoryTreeDeletion
} from './terminal-history-deletion'
import { hashWorktreeId } from './terminal-history-paths'
import { getWorkspaceNotesRoot } from './workspace-notes-paths'

/** Delete the notes directory for a removed workspace. Non-fatal; never blocks on recursive rm. */
export function deleteWorkspaceNotesDir(workspaceId: string): void {
  try {
    const notesRoot = getWorkspaceNotesRoot()
    if (
      scheduleWorktreeHistoryTreeDeletion(join(notesRoot, hashWorktreeId(workspaceId)), notesRoot)
    ) {
      console.log(`[workspace-notes] Scheduled notes delete for workspace ${workspaceId}`)
    }
  } catch (err) {
    console.warn(
      `[workspace-notes] Failed to schedule notes delete: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

/** Re-queue tombstones left by a quit mid-rm. */
export function schedulePendingWorkspaceNotesRemovals(): void {
  try {
    schedulePendingHistoryTreeRemovals(getWorkspaceNotesRoot())
  } catch (err) {
    console.warn(
      `[workspace-notes] Failed to drain pending notes removals: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
