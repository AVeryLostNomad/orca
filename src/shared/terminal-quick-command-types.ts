import type { TuiAgent } from './tui-agent'

export type TerminalQuickCommandScope =
  | {
      type: 'global'
    }
  | {
      type: 'repo'
      repoId: string
    }

export type TerminalQuickCommandAction = 'terminal-command' | 'agent-prompt'

/** 'tab' spawns a normal terminal tab; 'modal' runs the command in an ephemeral
 *  dialog over the terminal area that closes when the process exits. */
export type TerminalQuickCommandMode = 'tab' | 'modal'

export type TerminalQuickCommandBase = {
  id: string
  label: string
  scope?: TerminalQuickCommandScope
}

export type TerminalCommandQuickCommand = TerminalQuickCommandBase & {
  action?: 'terminal-command'
  command: string
  appendEnter: boolean
  // Why: absent means 'tab' so pre-mode payloads and peers stay byte-identical.
  mode?: TerminalQuickCommandMode
}

export type TerminalAgentQuickCommand = TerminalQuickCommandBase & {
  action: 'agent-prompt'
  agent: TuiAgent
  prompt: string
}

export type TerminalQuickCommand = TerminalCommandQuickCommand | TerminalAgentQuickCommand
