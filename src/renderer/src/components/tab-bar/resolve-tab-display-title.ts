import { stripLeadingAgentTitleDecoration } from '../../../../shared/agent-title-decoration'
import { isKnownHarnessInjectedUserTurnText } from '../../../../shared/harness-injected-user-turns'
import { isMsysPromptTitle } from '../../../../shared/shell-process-detection'
import type { TerminalAgent } from '../../../../shared/terminal-agent'
import { getAgentLabel } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'

// Why: Git Bash titles carry the full cwd and agents can echo harness markup as a title; both bloat tabs with noise.
export function resolveTabDisplayTitle(
  title: string,
  agent: TerminalAgent | null | undefined
): string {
  const stripped = agent ? stripLeadingAgentTitleDecoration(title) : title
  if (agent && isKnownHarnessInjectedUserTurnText(stripped)) {
    return getAgentLabel(agent)
  }
  if (isMsysPromptTitle(stripped)) {
    return agent ? getAgentLabel(agent) : translate('tabHoverCard.terminal', 'Terminal')
  }
  return stripped
}
