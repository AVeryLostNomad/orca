export type TerminalPaneProps = {
  tabId: string
  worktreeId: string
  cwd?: string
  isActive: boolean
  isVisible?: boolean
  isWorktreeActive?: boolean
  // Activity portals can isolate one split without changing expanded state or persistence.
  isolatedPaneKey?: string | null
  // Why: one-off command terminals keep split shortcuts but hide the prominent header button.
  showSplitButton?: boolean
  onPtyExit: (ptyId: string, exitCode?: number) => void
  onCloseTab: () => void
  // Why: hosts that present exit themselves replace the pane's Restart/Close overlay.
  onProcessFailed?: (exitCode: number) => void
}

export type TerminalPaneActiveInputState = {
  ptyId: string | null
  /** Full-screen TUIs (vim, less, htop) own every key while on the alternate screen. */
  isAlternateScreen: boolean
}

export type TerminalPaneHandle = {
  closeActivePane: () => void
  getActivePaneInputState: () => TerminalPaneActiveInputState | null
}
