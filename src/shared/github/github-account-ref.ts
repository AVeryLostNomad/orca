/**
 * Per-project GitHub account selection.
 *
 * A repo can pin the GitHub account Orca uses for it. The pin is stored as an
 * opaque ref string so one field covers both credential sources:
 *
 *   gh:<host>:<user>  — a gh CLI keyring account (token via `gh auth token`)
 *   pat:<id>          — an Orca-stored personal access token (for users who
 *                       don't use gh multi-account, or don't use gh keyring)
 *
 * Undefined/null ref = current behavior (gh's active account / ambient env).
 */

export type GithubAccountRef =
  | { kind: 'gh-cli'; host: string; user: string }
  | { kind: 'pat'; id: string }

/** Metadata for a stored PAT account; the token itself lives in an encrypted
 *  credential file keyed by `id`, never in persisted settings. */
export type GithubPatAccountMeta = {
  id: string
  label: string
  host: string
}

export function formatGithubAccountRef(ref: GithubAccountRef): string {
  return ref.kind === 'gh-cli' ? `gh:${ref.host}:${ref.user}` : `pat:${ref.id}`
}

export function parseGithubAccountRef(raw: string | null | undefined): GithubAccountRef | null {
  if (!raw) {
    return null
  }
  if (raw.startsWith('pat:')) {
    const id = raw.slice('pat:'.length)
    return id ? { kind: 'pat', id } : null
  }
  if (raw.startsWith('gh:')) {
    const rest = raw.slice('gh:'.length)
    // Host may contain a port (host:port); user is the final segment.
    const sep = rest.lastIndexOf(':')
    if (sep <= 0 || sep === rest.length - 1) {
      return null
    }
    return {
      kind: 'gh-cli',
      host: rest.slice(0, sep),
      user: rest.slice(sep + 1)
    }
  }
  return null
}

export function isValidGithubAccountRefString(raw: unknown): raw is string {
  return typeof raw === 'string' && parseGithubAccountRef(raw) !== null
}
