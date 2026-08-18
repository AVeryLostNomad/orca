import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { Repo } from '../../../../shared/repo-types'
import type { GhAuthAccount } from '../../../../shared/github/auth-types'
import {
  formatGithubAccountRef,
  parseGithubAccountRef
} from '../../../../shared/github/github-account-ref'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Input } from '../ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '../ui/select'
import { SearchableSetting } from './SearchableSetting'
import { useAppStore } from '../../store'
import { translate } from '@/i18n/i18n'
import { searchKeywords } from './settings-search-keywords'

const DEFAULT_VALUE = 'default'
const ADD_PAT_VALUE = 'add-pat'

type RepositoryGithubAccountSectionProps = {
  repo: Repo
  updateRepo: (repoId: string, updates: { githubAccountRef?: string | null }) => void
  forceVisible?: boolean
}

export function RepositoryGithubAccountSection({
  repo,
  updateRepo,
  forceVisible
}: RepositoryGithubAccountSectionProps): React.JSX.Element {
  const settings = useAppStore((state) => state.settings)
  const patAccounts = settings?.githubPatAccounts ?? []
  const [ghAccounts, setGhAccounts] = useState<GhAuthAccount[]>([])
  const [patDialogOpen, setPatDialogOpen] = useState(false)
  const [patLabel, setPatLabel] = useState('')
  const [patHost, setPatHost] = useState('github.com')
  const [patToken, setPatToken] = useState('')
  const [savingPat, setSavingPat] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api.gh
      .diagnoseAuth()
      .then((diag) => {
        if (!cancelled) {
          // Env-sourced entries aren't selectable identities — only keyring
          // accounts can be materialized later via `gh auth token --user`.
          setGhAccounts(diag.accounts.filter((account) => account.source === 'keyring'))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const currentRef = repo.githubAccountRef ?? null
  const parsedCurrent = parseGithubAccountRef(currentRef)
  // Keep a stale pin visible (e.g. gh account logged out) so the user can see and clear it.
  const currentIsListed =
    !parsedCurrent ||
    (parsedCurrent.kind === 'gh-cli'
      ? ghAccounts.some(
          (account) => account.host === parsedCurrent.host && account.user === parsedCurrent.user
        )
      : patAccounts.some((meta) => meta.id === parsedCurrent.id))

  const onSelect = (value: string): void => {
    if (value === ADD_PAT_VALUE) {
      setPatDialogOpen(true)
      return
    }
    updateRepo(repo.id, {
      githubAccountRef: value === DEFAULT_VALUE ? null : value
    })
  }

  const savePat = async (): Promise<void> => {
    if (savingPat) {
      return
    }
    setSavingPat(true)
    try {
      const meta = await window.api.gh.addPatAccount({
        label: patLabel.trim(),
        host: patHost.trim() || undefined,
        token: patToken.trim()
      })
      updateRepo(repo.id, { githubAccountRef: `pat:${meta.id}` })
      setPatDialogOpen(false)
      setPatLabel('')
      setPatToken('')
    } catch (error) {
      toast.error(
        translate(
          'auto.components.settings.RepositoryGithubAccountSection.patSaveFailed',
          'Could not save token'
        ),
        { description: error instanceof Error ? error.message : String(error) }
      )
    } finally {
      setSavingPat(false)
    }
  }

  const title = translate(
    'auto.components.settings.RepositoryGithubAccountSection.title',
    'GitHub Account'
  )
  return (
    <SearchableSetting
      title={title}
      description={translate(
        'auto.components.settings.RepositoryGithubAccountSection.description',
        'Pin the GitHub account Orca uses for this project.'
      )}
      keywords={searchKeywords([
        repo.displayName,
        'github',
        'gh',
        'account',
        'token',
        'pat',
        'auth',
        {
          key: 'auto.components.settings.repository.search.githubAccount',
          fallback: 'github account'
        },
        {
          key: 'auto.components.settings.repository.search.personalAccessToken',
          fallback: 'personal access token'
        }
      ])}
      className="space-y-2"
      forceVisible={forceVisible}
    >
      <Label className="text-sm font-semibold">{title}</Label>
      <p className="text-sm text-muted-foreground">
        {translate(
          'auto.components.settings.RepositoryGithubAccountSection.explainer',
          'Issues, pull requests, and terminals opened in this project authenticate as the pinned account. Terminals get a scoped GH_TOKEN, so `gh auth switch` inside them has no effect.'
        )}
      </p>
      <Select value={currentRef ?? DEFAULT_VALUE} onValueChange={onSelect}>
        <SelectTrigger className="w-full max-w-md">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_VALUE}>
            {translate(
              'auto.components.settings.RepositoryGithubAccountSection.defaultOption',
              'Default (active gh account)'
            )}
          </SelectItem>
          {ghAccounts.map((account) => {
            const ref = formatGithubAccountRef({
              kind: 'gh-cli',
              host: account.host,
              user: account.user
            })
            return (
              <SelectItem key={ref} value={ref}>
                {account.user} ({account.host})
              </SelectItem>
            )
          })}
          {patAccounts.map((meta) => (
            <SelectItem key={meta.id} value={`pat:${meta.id}`}>
              {meta.label} ({meta.host})
            </SelectItem>
          ))}
          {currentRef && !currentIsListed ? (
            <SelectItem value={currentRef}>
              {translate(
                'auto.components.settings.RepositoryGithubAccountSection.unavailableOption',
                '{{ref}} (unavailable)',
                { ref: currentRef }
              )}
            </SelectItem>
          ) : null}
          <SelectSeparator />
          <SelectItem value={ADD_PAT_VALUE}>
            {translate(
              'auto.components.settings.RepositoryGithubAccountSection.addPatOption',
              'Add personal access token…'
            )}
          </SelectItem>
        </SelectContent>
      </Select>
      {parsedCurrent?.kind === 'pat' ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            void window.api.gh.removePatAccount({ id: parsedCurrent.id })
            updateRepo(repo.id, { githubAccountRef: null })
          }}
        >
          {translate(
            'auto.components.settings.RepositoryGithubAccountSection.removePat',
            'Remove stored token'
          )}
        </Button>
      ) : null}
      <Dialog open={patDialogOpen} onOpenChange={setPatDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {translate(
                'auto.components.settings.RepositoryGithubAccountSection.patDialogTitle',
                'Add Personal Access Token'
              )}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'auto.components.settings.RepositoryGithubAccountSection.patDialogDescription',
                'The token is stored encrypted on this machine and never synced.'
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={patLabel}
              onChange={(e) => setPatLabel(e.target.value)}
              placeholder={translate(
                'auto.components.settings.RepositoryGithubAccountSection.patLabelPlaceholder',
                'Label (e.g. Work account)'
              )}
            />
            <Input
              value={patHost}
              onChange={(e) => setPatHost(e.target.value)}
              placeholder={translate(
                'auto.components.settings.RepositoryGithubAccountSection.patHostPlaceholder',
                'github.com'
              )}
            />
            <Input
              type="password"
              value={patToken}
              onChange={(e) => setPatToken(e.target.value)}
              placeholder={translate(
                'auto.components.settings.RepositoryGithubAccountSection.patTokenPlaceholder',
                'ghp_…'
              )}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setPatDialogOpen(false)}>
              {translate(
                'auto.components.settings.RepositoryGithubAccountSection.cancel',
                'Cancel'
              )}
            </Button>
            <Button
              type="button"
              disabled={savingPat || !patLabel.trim() || !patToken.trim()}
              onClick={() => void savePat()}
            >
              {translate('auto.components.settings.RepositoryGithubAccountSection.save', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SearchableSetting>
  )
}
