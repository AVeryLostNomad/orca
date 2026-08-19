import { useAppStore } from '@/store'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { resolveDefaultAgentForNewTab } from '@/lib/agent-tab-shortcuts'

export type QuickAiMatchCounts = {
  worktrees: number
  openTabs: number
  middle: number
  projectTargets: number
  files: number
}

/**
 * Show the "Or quick AI?" row only when a real query matched nothing at all —
 * per spec it is the fallback, not a standing affordance.
 */
export function shouldShowQuickAiRow(args: {
  query: string
  matchCounts: QuickAiMatchCounts
  hasUrlIntent: boolean
  eligible: boolean
}): boolean {
  if (!args.eligible || args.hasUrlIntent) {
    return false
  }
  if (args.query.trim().length < 2) {
    return false
  }
  const counts = args.matchCounts
  return (
    counts.worktrees === 0 &&
    counts.openTabs === 0 &&
    counts.middle === 0 &&
    counts.projectTargets === 0 &&
    counts.files === 0
  )
}

export type LaunchQuickAiResult =
  | { launched: true }
  | { launched: false; reason: 'no-active-workspace' | 'no-agent-available' }

/** Starts a default-agent session in the active workspace and submits the query as its prompt. */
export function launchQuickAi(args: { query: string }): LaunchQuickAiResult {
  const state = useAppStore.getState()
  const worktreeId = state.activeWorktreeId
  if (!worktreeId) {
    return { launched: false, reason: 'no-active-workspace' }
  }
  const agent = resolveDefaultAgentForNewTab({
    defaultTuiAgent: state.settings?.defaultTuiAgent,
    detectedAgentIds: state.detectedAgentIds,
    disabledTuiAgents: state.settings?.disabledTuiAgents
  })
  if (!agent) {
    return { launched: false, reason: 'no-agent-available' }
  }
  const result = launchAgentInNewTab({
    agent,
    worktreeId,
    prompt: args.query.trim(),
    promptDelivery: 'submit-after-ready',
    launchSource: 'command_palette'
  })
  return result ? { launched: true } : { launched: false, reason: 'no-agent-available' }
}
