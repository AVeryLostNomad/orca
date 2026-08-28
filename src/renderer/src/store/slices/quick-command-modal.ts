import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { TerminalCommandQuickCommand } from '../../../../shared/terminal-quick-command-types'

export type QuickCommandModalRequest = {
  /** UUID per launch: remounts the modal content and suffixes the ephemeral tab's worktree id. */
  requestId: string
  command?: TerminalCommandQuickCommand
  /** Real workspace id (worktree or folder key) the command targets. */
  worktreeId: string
  /** Workspace root, resolved at launch so the modal never guesses cwd. */
  cwd: string | null
}

export type QuickCommandModalSlice = {
  quickCommandModal: QuickCommandModalRequest | null
  openQuickCommandModal: (request: QuickCommandModalRequest) => void
  closeQuickCommandModal: () => void
}

export const createQuickCommandModalSlice: StateCreator<
  AppState,
  [],
  [],
  QuickCommandModalSlice
> = (set) => ({
  quickCommandModal: null,
  openQuickCommandModal: (request) => set({ quickCommandModal: request }),
  closeQuickCommandModal: () => set({ quickCommandModal: null })
})
