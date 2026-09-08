import type { Store } from '../persistence'
import type { StatsCollector } from '../stats/collector'
import { ghExecFileAsync } from '../git/runner'
import {
  setGhAccountEnvResolver,
  setGitAccountCredentialResolver,
  setGitAccountIdentityResolver
} from '../git/command-runner/github-account-env'
import {
  configureGithubAccountEnv,
  githubAccountCommitIdentityForCwd,
  githubAccountGitCredentialForCwd,
  githubAccountTokenForCwd,
  invalidateGithubAccountToken,
  prewarmGithubAccountTokens
} from '../github/github-account-env'
import { registerGitHubAccountHandlers } from './github-account-handlers'
import { registerGitHubIssueMutationHandlers } from './github-issue-mutation-handlers'
import { registerGitHubPRMutationHandlers } from './github-pr-mutation-handlers'
import { registerGitHubPRReadHandlers } from './github-pr-read-handlers'
import { registerGitHubPRRefreshHandlers } from './github-pr-refresh-handlers'
import { registerGitHubPRReviewHandlers } from './github-pr-review-handlers'
import { registerGitHubProjectViewHandlers } from './github-project-view-handlers'
import { registerGitHubWorkItemHandlers } from './github-work-item-handlers'

export function registerGitHubHandlers(store: Store, stats: StatsCollector): void {
  configureGithubAccountEnv({
    getRepos: () => store.getRepos(),
    ghExec: ghExecFileAsync,
    getPatAccounts: () => store.getSettings().githubPatAccounts ?? []
  })
  setGhAccountEnvResolver(githubAccountTokenForCwd, invalidateGithubAccountToken)
  setGitAccountCredentialResolver(githubAccountGitCredentialForCwd, invalidateGithubAccountToken)
  setGitAccountIdentityResolver(githubAccountCommitIdentityForCwd)
  prewarmGithubAccountTokens()

  registerGitHubPRRefreshHandlers(store, stats)
  registerGitHubWorkItemHandlers(store)
  registerGitHubPRReadHandlers(store)
  registerGitHubPRReviewHandlers(store)
  registerGitHubPRMutationHandlers(store)
  registerGitHubAccountHandlers(store)
  registerGitHubIssueMutationHandlers(store)
  registerGitHubProjectViewHandlers()
}
