import type { Repo } from '../../../../shared/repo-types'
import { isFolderRepo } from '../../../../shared/repo-kind'
import { RepositoryAgentAccountsSection } from './RepositoryAgentAccountsSection'
import { RepositoryGithubAccountSection } from './RepositoryGithubAccountSection'

type AccountPinUpdates = Partial<
  Pick<Repo, 'githubAccountRef' | 'claudeAccountId' | 'codexAccountId'>
>

/** GitHub (git projects only) and agent (local projects only) account pins. */
export function RepositoryAccountSections({
  repo,
  updateRepo,
  forceVisible
}: {
  repo: Repo
  updateRepo: (repoId: string, updates: AccountPinUpdates) => void
  forceVisible?: boolean
}): React.JSX.Element {
  return (
    <>
      {isFolderRepo(repo) ? null : (
        <RepositoryGithubAccountSection
          repo={repo}
          updateRepo={updateRepo}
          forceVisible={forceVisible}
        />
      )}
      <RepositoryAgentAccountsSection
        repo={repo}
        updateRepo={updateRepo}
        forceVisible={forceVisible}
      />
    </>
  )
}
