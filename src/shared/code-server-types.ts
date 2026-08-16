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

// Desktop editors whose config the embedded editor can adopt.
export type CodeServerImportSourceId = 'vscode' | 'vscode-insiders' | 'vscodium' | 'cursor'

export type CodeServerImportSource = {
  id: CodeServerImportSourceId
  name: string
  /** True when settings.json / keybindings.json / a snippets dir exists. */
  hasSettings: boolean
  hasKeybindings: boolean
  hasSnippets: boolean
  extensionCount: number
}

export type CodeServerImportState = {
  sources: CodeServerImportSource[]
  /** Editor currently mirrored into the embedded editor's user dir. */
  activeSourceId: CodeServerImportSourceId | null
  /** True once the user picked a source or dismissed the first-run prompt. */
  promptDismissed: boolean
}

export type CodeServerImportRequest = {
  sourceId: CodeServerImportSourceId
  includeExtensions: boolean
}

export type CodeServerImportResult =
  | { extensionsImported: number; extensionsSkipped: number; restarted: boolean }
  | { error: string }
