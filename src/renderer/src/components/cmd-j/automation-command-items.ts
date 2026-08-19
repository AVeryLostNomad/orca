import { useEffect, useState } from 'react'
import { CalendarClock, Play } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import type { Automation } from '../../../../shared/automations-types'
import {
  getAutomationListTarget,
  listAutomationsForTarget,
  runAutomationNowForTarget
} from '@/components/automations/automation-host-client'
import { translate } from '@/i18n/i18n'
import type { CmdJQuickAction } from './quick-actions'

/** Fetches automations once per palette open; a fetch failure hides the section. */
export function useCommandBarAutomations(visible: boolean): Automation[] {
  const [automations, setAutomations] = useState<Automation[]>([])

  useEffect(() => {
    if (!visible) {
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const target = getAutomationListTarget(useAppStore.getState().settings)
        const listed = await listAutomationsForTarget(target)
        if (!cancelled) {
          setAutomations(listed)
        }
      } catch {
        if (!cancelled) {
          setAutomations([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [visible])

  return automations
}

export function buildAutomationCommandItems(automations: Automation[]): CmdJQuickAction[] {
  return automations.flatMap((automation): CmdJQuickAction[] => [
    {
      id: `automation-run:${automation.id}`,
      kind: 'action',
      title: translate('auto.components.cmd.j.automations.run', 'Run Automation: {{value0}}', {
        value0: automation.name
      }),
      description: translate(
        'auto.components.cmd.j.automations.runDesc',
        'Start this automation now.'
      ),
      icon: Play,
      verbKeywords: [
        automation.name,
        translate('auto.components.cmd.j.automations.kw.run', 'run automation')
      ],
      isAvailable: () => ({ available: true }),
      run: async () => {
        try {
          await runAutomationNowForTarget(automation)
          toast.success(
            translate(
              'auto.components.cmd.j.automations.started',
              'Automation started: {{value0}}',
              {
                value0: automation.name
              }
            )
          )
        } catch (error) {
          toast.error(
            translate(
              'auto.components.cmd.j.automations.failed',
              'Failed to run automation: {{value0}}',
              { value0: error instanceof Error ? error.message : String(error) }
            )
          )
        }
        return { status: 'ok' }
      }
    },
    {
      id: `automation-open:${automation.id}`,
      kind: 'action',
      title: translate('auto.components.cmd.j.automations.open', 'Open Automation: {{value0}}', {
        value0: automation.name
      }),
      description: translate(
        'auto.components.cmd.j.automations.openDesc',
        'View this automation and its runs.'
      ),
      icon: CalendarClock,
      verbKeywords: [
        automation.name,
        translate('auto.components.cmd.j.automations.kw.open', 'open automation'),
        translate('auto.components.cmd.j.automations.kw.automation', 'automation')
      ],
      isAvailable: () => ({ available: true }),
      run: async () => {
        const state = useAppStore.getState()
        state.setSelectedAutomationId(automation.id)
        state.openAutomationsPage()
        return { status: 'ok' }
      }
    }
  ])
}
