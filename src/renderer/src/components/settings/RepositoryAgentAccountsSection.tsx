import { translate } from '@/i18n/i18n'
import type { Repo } from '../../../../shared/repo-types'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { resolveGroupAccountPin } from '../../../../shared/project-account-pins'
import { Label } from '../ui/label'
import { useAppStore } from '../../store'
import { SearchableSetting } from './SearchableSetting'
import { searchKeywords } from './settings-search-keywords'
import { useProjectAccountOptions } from '../project-accounts/project-account-options'
import {
  describeAccountPinFallback,
  ProjectAccountPinSelect
} from '../project-accounts/ProjectAccountPinSelect'

type AgentAccountField = 'claudeAccountId' | 'codexAccountId'

export function RepositoryAgentAccountsSection({
  repo,
  updateRepo,
  forceVisible
}: {
  repo: Repo
  updateRepo: (repoId: string, updates: Partial<Record<AgentAccountField, string | null>>) => void
  forceVisible?: boolean
}): React.JSX.Element | null {
  const projectGroups = useAppStore((state) => state.projectGroups)
  const options = useProjectAccountOptions()
  const hostId = getRepoExecutionHostId(repo)
  // Why: managed agent accounts live on this machine; SSH/runtime projects use their host's login.
  if (hostId !== LOCAL_EXECUTION_HOST_ID) {
    return null
  }

  const title = translate(
    'auto.components.settings.RepositoryAgentAccountsSection.title',
    'Agent Accounts'
  )
  const globalLabel = (account: string | null): string =>
    account
      ? translate(
          'auto.components.settings.RepositoryAgentAccountsSection.globalWithAccount',
          'Global selection ({{account}})',
          { account }
        )
      : translate(
          'auto.components.settings.RepositoryAgentAccountsSection.global',
          'Global selection'
        )

  const rows: {
    field: AgentAccountField
    label: string
    globalAccount: string | null
  }[] = [
    {
      field: 'claudeAccountId',
      label: 'Claude',
      globalAccount: options.globalClaudeLabel
    },
    {
      field: 'codexAccountId',
      label: 'Codex',
      globalAccount: options.globalCodexLabel
    }
  ]

  return (
    <SearchableSetting
      title={title}
      description={translate(
        'auto.components.settings.RepositoryAgentAccountsSection.description',
        'Pin the Claude and Codex accounts agents use in this project.'
      )}
      keywords={searchKeywords([
        repo.displayName,
        'claude',
        'codex',
        'agent',
        'account',
        'personal',
        'work'
      ])}
      className="space-y-2"
      forceVisible={forceVisible}
    >
      <Label className="text-sm font-semibold">{title}</Label>
      <p className="text-sm text-muted-foreground">
        {translate(
          'auto.components.settings.RepositoryAgentAccountsSection.explainer',
          'Agents started in this project sign in as the pinned account, alongside agents on other accounts. Unset accounts inherit from the project group, then the global selection. Applies to newly started agents.'
        )}
      </p>
      {rows.map(({ field, label, globalAccount }) => {
        const inherited = resolveGroupAccountPin(projectGroups, repo.projectGroupId, hostId, field)
        return (
          <div key={field} className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-sm text-muted-foreground">{label}</span>
            <ProjectAccountPinSelect
              value={repo[field] ?? null}
              options={options[field]}
              fallbackLabel={describeAccountPinFallback(
                inherited,
                options[field],
                globalLabel(globalAccount)
              )}
              onChange={(value) => updateRepo(repo.id, { [field]: value })}
              ariaLabel={translate(
                'auto.components.settings.RepositoryAgentAccountsSection.selectLabel',
                '{{agent}} account',
                { agent: label }
              )}
            />
          </div>
        )
      })}
    </SearchableSetting>
  )
}
