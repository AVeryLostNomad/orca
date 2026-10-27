import {
  cachedGithubAccountCommitIdentityForCwd,
  cachedGithubAccountTokenForCwd
} from '../../../github/github-account-env'
import { addWslEnvKeys } from '../../../wsl-env'

const COMMIT_IDENTITY_KEYS = [
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL'
] as const

/** Gives terminals the GitHub account and commit identity pinned to their cwd, unless the env already sets them. */
export function applyGithubAccountTerminalEnv(
  baseEnv: Record<string, string>,
  opts: { cwd?: string; isWsl?: boolean }
): void {
  if (baseEnv.GH_TOKEN === undefined && baseEnv.GITHUB_TOKEN === undefined) {
    const token = cachedGithubAccountTokenForCwd(opts.cwd)
    if (token) {
      baseEnv.GH_TOKEN = token
      if (opts.isWsl) {
        addWslEnvKeys(baseEnv, ['GH_TOKEN'])
      }
    }
  }
  if (COMMIT_IDENTITY_KEYS.some((key) => baseEnv[key] !== undefined)) {
    return
  }
  const identity = cachedGithubAccountCommitIdentityForCwd(opts.cwd)
  if (!identity) {
    return
  }
  baseEnv.GIT_AUTHOR_NAME = identity.name
  baseEnv.GIT_AUTHOR_EMAIL = identity.email
  baseEnv.GIT_COMMITTER_NAME = identity.name
  baseEnv.GIT_COMMITTER_EMAIL = identity.email
  if (opts.isWsl) {
    addWslEnvKeys(baseEnv, COMMIT_IDENTITY_KEYS)
  }
}
