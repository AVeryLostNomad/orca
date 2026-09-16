import {
  normalizeAgentStatusPayload,
  type ParsedAgentStatusPayload
} from '../../agent-status-types'
import { isAskUserQuestionTool } from '../../agent-question-answered-intent'
import {
  codexRosterToSnapshots,
  finishCodexSubagent,
  upsertCodexSubagent,
  type CodexSubagentRoster
} from '../../codex-subagent-roster'
import { clearPaneTurnCacheState, type HookListenerState } from '../listener-state'
import { resolvePrompt, resolveToolState } from '../prompt-fields'
import { extractToolFields, isNewTurnEvent } from '../provider-event-routing'
import { readString } from '../tool-input-preview'

export function normalizePiCompatibleEvent(
  state: HookListenerState,
  agentType: 'pi' | 'omp' | 'prime-agent',
  eventName: unknown,
  promptText: string,
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  if (agentType !== 'omp' && eventName === 'session_start') {
    // Why: Pi's session_start fires on TUI open/resume; discard stale turn details, no working row before user activity.
    clearPaneTurnCacheState(state, paneKey)
    state.piFamilySubagentRosterByPaneKey.delete(paneKey)
    state.piFamilyLeadStateByPaneKey.delete(paneKey)
    return null
  }
  if (eventName === 'subagent_start' || eventName === 'subagent_end') {
    return normalizePiFamilySubagentLifecycleEvent(
      state,
      agentType,
      eventName,
      paneKey,
      hookPayload
    )
  }

  // Why: gate on the event's own tool_name so a stale cached question can't re-enter blocked.
  const toolName = readString(hookPayload, 'tool_name')
  const isPiCompatibleAsk =
    ((agentType === 'pi' && isAskUserQuestionTool(toolName)) ||
      (agentType === 'omp' && toolName === 'ask')) &&
    (eventName === 'tool_call' || eventName === 'tool_execution_start')
  const isOmpApprovalRequest = agentType === 'omp' && eventName === 'tool_approval_requested'
  const isOmpApprovalResolution = agentType === 'omp' && eventName === 'tool_approval_resolved'

  const stateName =
    isPiCompatibleAsk || isOmpApprovalRequest
      ? 'blocked'
      : isOmpApprovalResolution ||
          eventName === 'before_agent_start' ||
          eventName === 'agent_start' ||
          eventName === 'tool_call' ||
          eventName === 'tool_execution_start' ||
          eventName === 'tool_execution_end' ||
          eventName === 'message_end'
        ? 'working'
        : eventName === 'agent_end'
          ? 'done'
          : null

  if (!stateName) {
    return null
  }
  state.piFamilyLeadStateByPaneKey.set(paneKey, stateName)

  const snapshot = resolveToolState(
    state,
    paneKey,
    extractToolFields(agentType, eventName, hookPayload),
    { resetOnNewTurn: isNewTurnEvent(agentType, eventName) }
  )

  return normalizeAgentStatusPayload({
    state: stateName,
    prompt: resolvePrompt(state, paneKey, promptText, {
      resetOnNewTurn: isNewTurnEvent(agentType, eventName)
    }),
    agentType,
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    interactivePrompt: snapshot.interactivePrompt,
    lastAssistantMessage: snapshot.lastAssistantMessage,
    lastAssistantMessageIsToolOutput: snapshot.lastAssistantMessageIsToolOutput,
    subagents: codexRosterToSnapshots(state.piFamilySubagentRosterByPaneKey.get(paneKey))
  })
}

function getOrCreatePiFamilySubagentRoster(
  state: HookListenerState,
  paneKey: string
): CodexSubagentRoster {
  let roster = state.piFamilySubagentRosterByPaneKey.get(paneKey)
  if (!roster) {
    roster = new Map()
    state.piFamilySubagentRosterByPaneKey.set(paneKey, roster)
  }
  return roster
}

/** OMP runs subagents in-process, so the status extension reports their lifecycle on the lead's
 *  pane. A child finishing is never the pane's completion: re-emit the cached lead state with the
 *  refreshed roster and stamp the finish so the renderer can offer it as its own notification. */
function normalizePiFamilySubagentLifecycleEvent(
  state: HookListenerState,
  agentType: 'pi' | 'omp' | 'prime-agent',
  eventName: 'subagent_start' | 'subagent_end',
  paneKey: string,
  hookPayload: Record<string, unknown>
): ParsedAgentStatusPayload | null {
  const subagentId = readString(hookPayload, 'subagent_id')
  if (!subagentId) {
    return null
  }
  const label = readString(hookPayload, 'subagent_label')
  const roster = getOrCreatePiFamilySubagentRoster(state, paneKey)
  const now = Date.now()
  let subagentCompletedAt: number | undefined
  if (eventName === 'subagent_start') {
    upsertCodexSubagent(roster, subagentId, { description: label, state: 'working' }, now)
  } else {
    finishCodexSubagent(roster, subagentId)
    subagentCompletedAt = now
    if (roster.size === 0) {
      state.piFamilySubagentRosterByPaneKey.delete(paneKey)
    }
  }
  // Why: a child ending with no lead evidence proves the parent is alive to receive its result.
  const leadState = state.piFamilyLeadStateByPaneKey.get(paneKey) ?? 'working'
  const snapshot = state.lastToolByPaneKey.get(paneKey) ?? {}
  return normalizeAgentStatusPayload({
    state: leadState,
    prompt: resolvePrompt(state, paneKey, '', { resetOnNewTurn: false }),
    agentType,
    toolName: snapshot.toolName,
    toolInput: snapshot.toolInput,
    interactivePrompt: snapshot.interactivePrompt,
    lastAssistantMessage: snapshot.lastAssistantMessage,
    lastAssistantMessageIsToolOutput: snapshot.lastAssistantMessageIsToolOutput,
    subagentCompletedAt,
    subagentCompletedLabel: subagentCompletedAt !== undefined ? label : undefined,
    subagents: codexRosterToSnapshots(state.piFamilySubagentRosterByPaneKey.get(paneKey))
  })
}
