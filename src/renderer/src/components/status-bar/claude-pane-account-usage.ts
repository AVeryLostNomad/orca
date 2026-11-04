import type { ClaudeManagedAccount } from '../../../../shared/managed-account-types'
import type { ProviderRateLimits, RateLimitState } from '../../../../shared/rate-limit-types'
import { resolveClaudePaneFolder } from '@/lib/claude-pane-account-folder'
import type { FocusedPaneUsage } from './focused-pane-usage'
import { createPendingProviderSnapshot } from './status-bar-provider-visibility'

export type ClaudePaneAccountUsage = {
  usage: FocusedPaneUsage
  /** The pane's account is not the selected one and its usage has not been fetched yet. */
  needsInactiveFetch: boolean
}

/**
 * Claude panes without a live statusLine feed (e.g. a user-owned statusLine) still show
 * the usage of the account their transcript folder belongs to.
 */
export function resolveClaudePaneAccountUsage(args: {
  rateLimits: Pick<RateLimitState, 'claude' | 'claudeTarget' | 'inactiveClaudeAccounts'>
  paneKey: string
  transcriptPath: string | undefined
  savedAccounts: readonly ClaudeManagedAccount[]
  activeAccountId: string | null
}): ClaudePaneAccountUsage | null {
  const { rateLimits, savedAccounts, activeAccountId } = args
  // Why: the selection compared here is the host's; WSL lanes keep their own.
  if (rateLimits.claudeTarget.runtime !== 'host') {
    return null
  }
  const folder = resolveClaudePaneFolder(args.transcriptPath, savedAccounts)
  if (folder?.kind !== 'account' && folder?.kind !== 'system-default') {
    return null
  }
  const paneAccountId = folder.kind === 'account' ? folder.accountId : null
  let provider: ProviderRateLimits | null
  let needsInactiveFetch = false
  if (paneAccountId === activeAccountId) {
    provider = rateLimits.claude
  } else if (paneAccountId !== null) {
    const inactive = rateLimits.inactiveClaudeAccounts.find(
      (entry) => entry.accountId === paneAccountId
    )
    provider = inactive?.rateLimits ?? createPendingProviderSnapshot('claude')
    needsInactiveFetch = !inactive
  } else {
    // Why: System default usage is only fetched while it is the selected account.
    return null
  }
  if (!provider) {
    return null
  }
  const label =
    paneAccountId === null
      ? null
      : (savedAccounts.find((account) => account.id === paneAccountId)?.email ?? null)
  return {
    usage: {
      snapshot: {
        paneKey: args.paneKey,
        agent: 'claude',
        updatedAt: provider.updatedAt,
        accounts: [{ provider: 'anthropic', label, active: true, limits: [] }],
        session: null
      },
      providers: [provider],
      otherAccounts: []
    },
    needsInactiveFetch
  }
}
