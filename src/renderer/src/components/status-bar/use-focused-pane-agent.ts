import { useAppStore } from '../../store'
import type { AppState } from '../../store/types'
import { getActiveTerminalNoteTarget } from '@/lib/active-agent-note-target'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { normalizeAgentProviderSession } from '../../../../shared/agent-session-resume'

function selectFocusedPaneKey(state: AppState): string | null {
  const worktreeId = state.activeWorktreeId
  if (!worktreeId) {
    return null
  }
  const target = getActiveTerminalNoteTarget(state, worktreeId)
  if (!target) {
    return null
  }
  try {
    return makePaneKey(target.tabId, target.leafId)
  } catch {
    // Why: makePaneKey rejects malformed tab ids; such a pane simply has no usage.
    return null
  }
}

/** The focused terminal pane, the agent it runs, and its transcript; all primitives so selectors stay stable. */
export function useFocusedPaneAgent(): {
  paneKey: string | null
  agent: string | null
  transcriptPath: string | undefined
} {
  const paneKey = useAppStore(selectFocusedPaneKey)
  const agent = useAppStore((state) => {
    if (!paneKey) {
      return null
    }
    return (
      state.agentStatusByPaneKey[paneKey]?.agentType ??
      state.paneForegroundAgentByPaneKey[paneKey]?.agent ??
      null
    )
  })
  const transcriptPath = useAppStore((state) =>
    paneKey
      ? normalizeAgentProviderSession(state.agentStatusByPaneKey[paneKey]?.providerSession)
          ?.transcriptPath
      : undefined
  )
  return { paneKey, agent, transcriptPath }
}
