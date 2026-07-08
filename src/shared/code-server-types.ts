// Shared across main, preload, and renderer — describes the code-server
// lifecycle surfaced to the VS Code pane.
export type CodeServerStatus =
  | 'not-installed'
  | 'installing'
  | 'starting'
  | 'ready'
  | 'error'
  | 'stopped'

export type CodeServerStatusEvent = {
  status: CodeServerStatus
  port: number | null
  /** 0..1 while status === 'installing'; omitted otherwise. */
  progress?: number
  /** Human-readable reason when status === 'error'. */
  error?: string
}
