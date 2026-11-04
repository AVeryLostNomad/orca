import { describe, expect, it } from 'vitest'
import type { ClaudeManagedAccount } from '../../../../shared/managed-account-types'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { createEmptyRateLimitState } from '../../../../shared/rate-limit-state-factory'
import { resolveClaudePaneAccountUsage } from './claude-pane-account-usage'

const work = {
  id: 'work',
  email: 'work@example.com',
  managedAuthPath: '/accounts/work'
} as ClaudeManagedAccount // SAFETY: only id, email and managedAuthPath are read.

function usage(usedPercent: number): ProviderRateLimits {
  return {
    provider: 'claude',
    session: { usedPercent, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: null,
    updatedAt: 1,
    error: null,
    status: 'ok'
  }
}

function resolve(transcriptPath: string, activeAccountId: string | null, inactive = false) {
  return resolveClaudePaneAccountUsage({
    rateLimits: createEmptyRateLimitState({
      claude: usage(10),
      inactiveClaudeAccounts: inactive
        ? [{ accountId: 'work', rateLimits: usage(70), updatedAt: 1, isFetching: false }]
        : []
    }),
    paneKey: 'tab:leaf',
    transcriptPath,
    savedAccounts: [work],
    activeAccountId
  })
}

describe('resolveClaudePaneAccountUsage', () => {
  it('shows the selected account when the pane runs on it', () => {
    const result = resolve('/accounts/work/projects/x/s.jsonl', 'work')
    expect(result?.usage.providers[0].session?.usedPercent).toBe(10)
    expect(result?.usage.snapshot.accounts[0].label).toBe('work@example.com')
  })

  it('shows another account’s cached usage, or a pending bar that requests it', () => {
    expect(
      resolve('/accounts/work/projects/x/s.jsonl', null, true)?.usage.providers[0].session
        ?.usedPercent
    ).toBe(70)
    const pending = resolve('/accounts/work/projects/x/s.jsonl', null)
    expect(pending?.needsInactiveFetch).toBe(true)
    expect(pending?.usage.providers[0].session).toBeNull()
  })

  it('stays out when a System default pane runs beside a selected managed account', () => {
    expect(resolve('/Users/me/.claude/projects/x/s.jsonl', 'work')).toBeNull()
  })
})
