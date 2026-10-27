import { createHash } from 'node:crypto'
import type { GitHubRepoExecOptions } from './github-api-repository'
import { githubAccountRefForCwd } from './github-account-env'

export function githubReadExecutionScope(
  options: GitHubRepoExecOptions,
  environment: NodeJS.ProcessEnv = options.env ?? process.env
): string {
  const {
    admissionTier: _admissionTier,
    accountCwdHint,
    ...executionOptions
  } = options as GitHubRepoExecOptions & { accountCwdHint?: string }
  // Key by the pinned account, not the hint path, so cwd-less SSH reads still share a batch.
  const pinnedAccountRef = accountCwdHint ? githubAccountRefForCwd(accountCwdHint) : null
  // gh wrappers and credential selection can depend on cwd and the inherited environment.
  return createHash('sha256')
    .update(
      JSON.stringify([
        executionOptions,
        pinnedAccountRef,
        process.cwd(),
        Object.entries(environment).sort(([a], [b]) => a.localeCompare(b))
      ])
    )
    .digest('hex')
}
