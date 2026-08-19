import { Bot, Settings } from 'lucide-react'
import { useAppStore } from '@/store'
import { dispatchAppCommand } from '@/lib/app-command-dispatch'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { resolveDefaultAgentForNewTab } from '@/lib/agent-tab-shortcuts'
import { translate } from '@/i18n/i18n'
import type { CmdJQuickAction } from './quick-actions'
import { getWorkspaceScopedActionAvailability } from './quick-action-context'
import { getAliasItemSpecs } from './keybinding-command-alias-specs'

/** Palette items bridged to renderer command handlers plus direct launchers. */
export function buildKeybindingCommandItems(): CmdJQuickAction[] {
  const aliasItems: CmdJQuickAction[] = getAliasItemSpecs().map((spec) => ({
    id: `command:${spec.actionId}`,
    kind: 'action',
    title: spec.title,
    description: spec.description,
    icon: spec.icon,
    verbKeywords: spec.verbKeywords,
    shortcutActionId: spec.actionId,
    isAvailable: (ctx) =>
      spec.workspaceScoped ? getWorkspaceScopedActionAvailability(ctx) : { available: true },
    run: async () => {
      // Handlers guard their own context; an unclaimed dispatch is a quiet
      // no-op, matching the chord's behavior.
      dispatchAppCommand(spec.actionId, 'command-bar')
      return { status: 'ok' }
    }
  }))

  const newAgentTab: CmdJQuickAction = {
    id: 'command:tab.newAgent',
    kind: 'action',
    title: translate('auto.components.cmd.j.commands.newAgentTab', 'New Agent Tab'),
    description: translate(
      'auto.components.cmd.j.commands.newAgentTabDesc',
      'Start your default AI agent in the active workspace.'
    ),
    icon: Bot,
    shortcutActionId: 'tab.newAgent',
    verbKeywords: [
      translate('auto.components.cmd.j.commands.kw.newAgent', 'new agent'),
      translate('auto.components.cmd.j.commands.kw.aiSession', 'ai session'),
      translate('auto.components.cmd.j.commands.kw.startAgent', 'start agent'),
      translate('auto.components.cmd.j.commands.kw.claude', 'claude'),
      translate('auto.components.cmd.j.commands.kw.codex', 'codex')
    ],
    isAvailable: (ctx) => getWorkspaceScopedActionAvailability(ctx),
    run: async (ctx) => {
      const availability = getWorkspaceScopedActionAvailability(ctx)
      if (!availability.available) {
        return { status: 'unavailable', reason: availability.reason }
      }
      const state = useAppStore.getState()
      const agent = resolveDefaultAgentForNewTab({
        defaultTuiAgent: state.settings?.defaultTuiAgent,
        detectedAgentIds: state.detectedAgentIds,
        disabledTuiAgents: state.settings?.disabledTuiAgents
      })
      if (!agent || !ctx.activeWorktreeId) {
        return { status: 'unavailable', reason: 'no-active-workspace' }
      }
      launchAgentInNewTab({
        agent,
        worktreeId: ctx.activeWorktreeId,
        groupId: ctx.activeGroupId ?? undefined,
        launchSource: 'command_palette'
      })
      return { status: 'ok' }
    }
  }

  const openSettings: CmdJQuickAction = {
    id: 'command:app.settings',
    kind: 'action',
    title: translate('auto.components.cmd.j.commands.openSettings', 'Open Settings'),
    description: translate(
      'auto.components.cmd.j.commands.openSettingsDesc',
      'Open the Orca settings.'
    ),
    icon: Settings,
    shortcutActionId: 'app.settings',
    verbKeywords: [
      translate('auto.components.cmd.j.commands.kw.settings', 'settings'),
      translate('auto.components.cmd.j.commands.kw.preferences', 'preferences')
    ],
    isAvailable: () => ({ available: true }),
    run: async () => {
      useAppStore.getState().openSettingsPage()
      return { status: 'ok' }
    }
  }

  return [...aliasItems, newAgentTab, openSettings]
}
