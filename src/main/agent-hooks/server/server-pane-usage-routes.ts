import {
  CLAUDE_STATUSLINE_PATHNAME,
  parseClaudeStatusLineBody
} from '../../../shared/claude-statusline-rate-limits'
import { parsePaneUsageBody } from '../../../shared/pane-usage-body'
import { OMP_USAGE_PATHNAME } from '../../../shared/pane-usage-types'
import type { ServerPaneUsageListener, ServerStatusLineListener } from './server-types'

type PaneUsageRouteTargets = {
  /** Moved panes report under their owner's key, as status rows do. */
  resolvePaneKey: (paneKey: string) => string
  onClaudeStatusLine: ServerStatusLineListener
  onPaneUsage: ServerPaneUsageListener
}

/** Usage posts feed RateLimitService, not agent status; returns whether `pathname` was one. */
export function receivePaneUsagePost(
  pathname: string,
  body: unknown,
  targets: PaneUsageRouteTargets
): boolean {
  if (pathname === CLAUDE_STATUSLINE_PATHNAME) {
    const event = parseClaudeStatusLineBody(body)
    if (event) {
      targets.onClaudeStatusLine?.(
        event.paneKey ? { ...event, paneKey: targets.resolvePaneKey(event.paneKey) } : event
      )
    }
    return true
  }
  if (pathname === OMP_USAGE_PATHNAME) {
    const snapshot = parsePaneUsageBody(body)
    if (snapshot) {
      targets.onPaneUsage?.({ ...snapshot, paneKey: targets.resolvePaneKey(snapshot.paneKey) })
    }
    return true
  }
  return false
}
