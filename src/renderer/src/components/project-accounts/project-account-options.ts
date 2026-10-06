import { useEffect, useState } from 'react'
import { useAppStore } from '../../store'
import type { GhAuthAccount } from '../../../../shared/github/auth-types'
import { formatGithubAccountRef } from '../../../../shared/github/github-account-ref'
import type { ProjectAccountPinField } from '../../../../shared/project-account-pin-types'

export type ProjectAccountOption = { value: string; label: string }

export type ProjectAccountOptions = Record<ProjectAccountPinField, ProjectAccountOption[]> & {
  /** Label of the account each agent uses when nothing is pinned. */
  globalClaudeLabel: string | null
  globalCodexLabel: string | null
}

function agentAccountLabel(account: {
  email: string
  organizationName?: string | null
  workspaceLabel?: string | null
}): string {
  const scope = account.organizationName ?? account.workspaceLabel
  return scope ? `${account.email} (${scope})` : account.email
}

/** Local GitHub, Claude and Codex accounts a project or group can pin. */
export function useProjectAccountOptions(): ProjectAccountOptions {
  const patAccounts = useAppStore((state) => state.settings?.githubPatAccounts)
  const [ghAccounts, setGhAccounts] = useState<GhAuthAccount[]>([])
  const [agentOptions, setAgentOptions] = useState<
    Pick<ProjectAccountOptions, 'claudeAccountId' | 'codexAccountId'> & {
      globalClaudeLabel: string | null
      globalCodexLabel: string | null
    }
  >({
    claudeAccountId: [],
    codexAccountId: [],
    globalClaudeLabel: null,
    globalCodexLabel: null
  })

  useEffect(() => {
    let cancelled = false
    window.api.gh
      .diagnoseAuth()
      .then((diag) => {
        if (!cancelled) {
          // Env-sourced entries aren't selectable identities — only keyring accounts can be materialized.
          setGhAccounts(diag.accounts.filter((account) => account.source === 'keyring'))
        }
      })
      .catch(() => {})
    void Promise.all([
      window.api.claudeAccounts.list().catch(() => null),
      window.api.codexAccounts.list().catch(() => null)
    ]).then(([claude, codex]) => {
      if (cancelled) {
        return
      }
      // Why: pins apply to host launches only; WSL accounts follow their distro's own selection.
      const claudeHost = (claude?.accounts ?? []).filter((a) => a.managedAuthRuntime !== 'wsl')
      const codexHost = (codex?.accounts ?? []).filter((a) => a.managedHomeRuntime !== 'wsl')
      const claudeActive = claude?.activeAccountIdsByRuntime?.host ?? claude?.activeAccountId
      const codexActive = codex?.activeAccountIdsByRuntime?.host ?? codex?.activeAccountId
      const activeClaude = claudeHost.find((account) => account.id === claudeActive)
      const activeCodex = codexHost.find((account) => account.id === codexActive)
      setAgentOptions({
        claudeAccountId: claudeHost.map((a) => ({
          value: a.id,
          label: agentAccountLabel(a)
        })),
        codexAccountId: codexHost.map((a) => ({
          value: a.id,
          label: agentAccountLabel(a)
        })),
        globalClaudeLabel: activeClaude ? agentAccountLabel(activeClaude) : null,
        globalCodexLabel: activeCodex
          ? agentAccountLabel(activeCodex)
          : (codex?.systemDefault?.email ?? null)
      })
    })
    return () => {
      cancelled = true
    }
  }, [])

  return {
    githubAccountRef: [
      ...ghAccounts.map((account) => ({
        value: formatGithubAccountRef({
          kind: 'gh-cli',
          host: account.host,
          user: account.user
        }),
        label: `${account.user} (${account.host})`
      })),
      ...(patAccounts ?? []).map((meta) => ({
        value: `pat:${meta.id}`,
        label: `${meta.label} (${meta.host})`
      }))
    ],
    ...agentOptions
  }
}

export function labelForAccountPin(
  options: readonly ProjectAccountOption[],
  value: string | null
): string | null {
  if (!value) {
    return null
  }
  return options.find((option) => option.value === value)?.label ?? value
}
