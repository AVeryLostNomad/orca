import { useAppStore } from '@/store'
import { dispatchTerminalNotification } from '@/components/terminal-pane/use-notification-dispatch'
import type { AgentCompletionStatusSnapshot } from '@/components/terminal-pane/agent-completion-coordinator-types'

// Why: a child finish is re-emitted with the unchanged lead state, so relay replays and roster
// refreshes carry the same stamp; remember it per pane to announce each finish once.
const lastAnnouncedSubagentCompletedAtByPaneKey = new Map<string, number>()

function isSubagentTaskCompleteNotificationEnabled(): boolean {
  const notifications = useAppStore.getState().settings?.notifications
  return notifications?.enabled !== false && notifications?.subagentTaskComplete === true
}

/** Announce an in-process subagent/background-task finish stamped on the pane's lead row. */
export function announceSubagentCompletion(
  paneKey: string,
  worktreeId: string,
  payload: AgentCompletionStatusSnapshot
): void {
  const completedAt = payload.subagentCompletedAt
  if (typeof completedAt !== 'number' || !Number.isFinite(completedAt)) {
    return
  }
  if (lastAnnouncedSubagentCompletedAtByPaneKey.get(paneKey) === completedAt) {
    return
  }
  lastAnnouncedSubagentCompletedAtByPaneKey.set(paneKey, completedAt)
  if (!isSubagentTaskCompleteNotificationEnabled()) {
    return
  }
  dispatchTerminalNotification(worktreeId, {
    source: 'subagent-task-complete',
    paneKey,
    agentStatusSnapshot: payload
  })
}

export function forgetSubagentCompletionAnnouncements(paneKey: string): void {
  lastAnnouncedSubagentCompletedAtByPaneKey.delete(paneKey)
}

export function resetSubagentCompletionAnnouncements(): void {
  lastAnnouncedSubagentCompletedAtByPaneKey.clear()
}
