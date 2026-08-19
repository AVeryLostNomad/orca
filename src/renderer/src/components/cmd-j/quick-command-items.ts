import { Play } from 'lucide-react'
import {
  normalizeTerminalQuickCommands,
  terminalQuickCommandMatchesRepo
} from '../../../../shared/terminal-quick-commands'
import type { TerminalQuickCommand } from '../../../../shared/terminal-quick-command-types'
import { runQuickCommandInNewTab } from '@/lib/run-quick-command-in-new-tab'
import { translate } from '@/i18n/i18n'
import type { CmdJQuickAction } from './quick-actions'
import { getWorkspaceScopedActionAvailability } from './quick-action-context'

/** One "Run: <label>" palette item per saved quick command visible to the active repo. */
export function buildQuickCommandItems(args: {
  activeRepoId: string | null
  quickCommands: unknown
}): CmdJQuickAction[] {
  const commands = normalizeTerminalQuickCommands(args.quickCommands).filter((command) =>
    terminalQuickCommandMatchesRepo(command, args.activeRepoId)
  )

  return commands.map((command: TerminalQuickCommand) => ({
    id: `quick-command:${command.id}`,
    kind: 'action',
    title: translate('auto.components.cmd.j.quickCommands.run', 'Run: {{value0}}', {
      value0: command.label
    }),
    description:
      command.action === 'agent-prompt'
        ? translate(
            'auto.components.cmd.j.quickCommands.agentDesc',
            'Start {{value0}} with this saved prompt.',
            { value0: command.agent }
          )
        : translate(
            'auto.components.cmd.j.quickCommands.terminalDesc',
            'Run this saved command in a new terminal tab.'
          ),
    icon: Play,
    verbKeywords: [
      command.label,
      translate('auto.components.cmd.j.quickCommands.kw.run', 'run'),
      translate('auto.components.cmd.j.quickCommands.kw.quickCommand', 'quick command'),
      ...(command.action === 'agent-prompt' ? [] : [command.command])
    ],
    isAvailable: (ctx) => getWorkspaceScopedActionAvailability(ctx),
    run: async (ctx) => {
      const availability = getWorkspaceScopedActionAvailability(ctx)
      if (!availability.available) {
        return { status: 'unavailable', reason: availability.reason }
      }
      if (!ctx.activeWorktreeId) {
        return { status: 'unavailable', reason: 'no-active-workspace' }
      }
      runQuickCommandInNewTab({
        command,
        worktreeId: ctx.activeWorktreeId,
        groupId: ctx.activeGroupId ?? undefined
      })
      return { status: 'ok' }
    }
  }))
}
