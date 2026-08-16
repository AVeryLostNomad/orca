// Shared across main, preload, and renderer — describes the code-server
// lifecycle surfaced to the VS Code pane.
export type CodeServerStatus =
  | 'not-installed'
  | 'installing'
  | 'starting'
  | 'ready'
  | 'error'
  | 'stopped'

// Embedded VS Code (code-server) tab. Flat — VS Code has no sub-pages.
export type CodeServerTab = {
  id: string
  worktreeId: string
  folderPath: string // the worktree working dir, opened via ?folder=
  label: string
}

export type CodeServerStatusEvent = {
  status: CodeServerStatus
  port: number | null
  /** 0..1 while status === 'installing'; omitted otherwise. */
  progress?: number
  /** Human-readable reason when status === 'error'. */
  error?: string
}
