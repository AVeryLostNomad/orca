import { useEffect } from 'react'
import { useAppStore } from '../../store'
import type { RateLimitState } from '../../../../shared/rate-limit-types'
import { resolveClaudePaneAccountUsage } from './claude-pane-account-usage'
import { resolveFocusedPaneUsage, type FocusedPaneUsage } from './focused-pane-usage'
import { useFocusedPaneAgent } from './use-focused-pane-agent'

/** Usage for the focused pane: its live report, else (Claude) the account its transcript belongs to. */
export function useFocusedPaneUsage(
  rateLimits: RateLimitState,
  remoteOwned: boolean
): FocusedPaneUsage | null {
  const { paneKey, agent, transcriptPath } = useFocusedPaneAgent()
  const savedAccounts = useAppStore((s) => s.settings?.claudeManagedAccounts)
  const activeAccountId = useAppStore(
    (s) =>
      s.settings?.activeClaudeManagedAccountIdsByRuntime?.host ??
      s.settings?.activeClaudeManagedAccountId ??
      null
  )
  const fetchInactiveClaudeAccountUsage = useAppStore((s) => s.fetchInactiveClaudeAccountUsage)
  const reported = resolveFocusedPaneUsage(rateLimits, paneKey, agent)
  // Why: transcript folders name this device's accounts, which say nothing about a remote owner's.
  const fallback =
    !reported && !remoteOwned && paneKey && agent === 'claude'
      ? resolveClaudePaneAccountUsage({
          rateLimits,
          paneKey,
          transcriptPath,
          savedAccounts: savedAccounts ?? [],
          activeAccountId
        })
      : null
  const needsInactiveFetch = fallback?.needsInactiveFetch === true
  useEffect(() => {
    if (needsInactiveFetch) {
      void fetchInactiveClaudeAccountUsage()
    }
  }, [needsInactiveFetch, paneKey, fetchInactiveClaudeAccountUsage])
  return reported ?? fallback?.usage ?? null
}
