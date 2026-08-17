export type WorkspaceNotesEnsureRequest = {
  /** Worktree id or folder-workspace key that owns the notes file. */
  workspaceId: string
  /** Display name baked into the template header at creation time. */
  displayName: string
}

export type WorkspaceNotesEnsureResult = {
  filePath: string
}
