import type { AgentStartupShell } from './tui-agent-startup-shell'

/**
 * Popup tasks end their shell with the command, so the popup lands on the
 * task's output instead of a fresh prompt and the exit code reaches the host.
 */
export function buildPopupTaskStartupCommand(command: string, shell: AgentStartupShell): string {
  // Why: a trailing `;` would turn the appended `; exit` into a POSIX syntax error.
  const body = command.trim().replace(/[;\s]+$/, '')
  switch (shell) {
    case 'cmd':
      return `${body} & exit`
    case 'powershell':
      return `${body}; exit $LASTEXITCODE`
    case 'posix':
      return `${body}; exit`
  }
}
