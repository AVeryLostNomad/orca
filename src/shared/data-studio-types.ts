import type { CodeServerStatusEvent } from './code-server-types'

// Embedded Data Studio (code-server + database extensions) tab. Flat — no sub-pages.
// Connections are per project: every worktree of a repo shares that repo's
// dedicated server process and profile, so `repoId` is the scoping key.
export type DataStudioTab = {
  id: string
  worktreeId: string
  repoId: string
  folderPath: string // the worktree working dir, opened via ?folder=
  label: string
}

export type DataStudioStatusEvent = CodeServerStatusEvent & { repoId: string }

export type DataStudioEnsureRunningResult = {
  port: number
  // Per-repo webview partition — the workbench's secret storage (saved DB
  // passwords) lives in the guest's browser storage, so it must be repo-scoped.
  partition: string
}
