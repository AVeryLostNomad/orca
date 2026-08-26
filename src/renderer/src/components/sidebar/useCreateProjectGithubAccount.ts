import { useEffect, useState } from 'react'
import type { GhAuthAccount } from '../../../../shared/github/auth-types'
import { formatGithubAccountRef } from '../../../../shared/github/github-account-ref'

export function useCreateProjectGithubAccount(): {
  githubAccounts: GhAuthAccount[]
  githubAccountsLoading: boolean
  githubAccountRef: string | null
  setGithubAccountRef: (value: string | null) => void
} {
  const [githubAccounts, setGithubAccounts] = useState<GhAuthAccount[]>([])
  const [githubAccountsLoading, setGithubAccountsLoading] = useState(true)
  const [githubAccountRef, setGithubAccountRef] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.gh
      .diagnoseAuth()
      .then((diagnostic) => {
        if (cancelled) {
          return
        }
        const accounts = diagnostic.accounts.filter((account) => account.source === 'keyring')
        setGithubAccounts(accounts)
        const selected = accounts.find((account) => account.active) ?? accounts[0]
        setGithubAccountRef(
          selected
            ? formatGithubAccountRef({
                kind: 'gh-cli',
                host: selected.host,
                user: selected.user
              })
            : null
        )
      })
      .catch(() => {
        if (!cancelled) {
          setGithubAccounts([])
          setGithubAccountRef(null)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setGithubAccountsLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return {
    githubAccounts,
    githubAccountsLoading,
    githubAccountRef,
    setGithubAccountRef
  }
}
