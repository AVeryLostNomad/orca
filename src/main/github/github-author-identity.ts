import type { GitAuthorIdentity } from '../../shared/git-author-identity'
import { normalizeGitAuthorIdentity } from '../../shared/git-author-identity'
import { parseGithubAccountRef } from '../../shared/github/github-account-ref'
import { ghExecFileAsync } from '../git/runner'
import { resolveGithubAccountToken } from './github-account-env'

type GithubViewerProfile = {
  id?: number
  login?: string
  name?: string | null
  email?: string | null
  url?: string | null
}

function githubNoReplyEmail(profile: GithubViewerProfile, host: string): string {
  const login = profile.login?.trim() ?? ''
  if (host === 'github.com' && Number.isSafeInteger(profile.id) && Number(profile.id) > 0) {
    return `${profile.id}+${login}@users.noreply.github.com`
  }
  return `${login}@users.noreply.${host}`
}

export async function resolveGithubAuthorIdentity(
  accountRef?: string
): Promise<GitAuthorIdentity | null> {
  const parsedRef = accountRef ? parseGithubAccountRef(accountRef) : null
  if (accountRef && parsedRef?.kind !== 'gh-cli') {
    return null
  }

  const token = accountRef ? await resolveGithubAccountToken(accountRef) : null
  if (accountRef && !token) {
    return null
  }

  const requestedHost = parsedRef?.kind === 'gh-cli' ? parsedRef.host : null
  const args = [
    'api',
    ...(requestedHost ? ['--hostname', requestedHost] : []),
    'user',
    '--jq',
    '{id: .id, login: .login, name: .name, email: .email, url: .html_url}'
  ]
  try {
    const { stdout } = await ghExecFileAsync(args, {
      skipAccountEnv: true,
      ...(token
        ? {
            env: {
              ...process.env,
              GH_TOKEN: token,
              GH_ENTERPRISE_TOKEN: token
            }
          }
        : {})
    })
    const profile = JSON.parse(stdout) as GithubViewerProfile
    const login = profile.login?.trim() ?? ''
    if (!login) {
      return null
    }
    let host = requestedHost ?? 'github.com'
    if (!requestedHost && profile.url) {
      try {
        host = new URL(profile.url).hostname || host
      } catch {
        // Keep github.com for malformed profile URLs.
      }
    }
    return normalizeGitAuthorIdentity({
      name: profile.name?.trim() || login,
      email: profile.email?.trim() || githubNoReplyEmail(profile, host)
    })
  } catch {
    return null
  }
}
