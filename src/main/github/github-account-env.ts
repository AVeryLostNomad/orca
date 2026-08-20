import { readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import type { Repo } from '../../shared/repo-types'
import {
  parseGithubAccountRef,
  type GithubAccountRef,
  type GithubPatAccountMeta
} from '../../shared/github/github-account-ref'
import { loadGithubPatToken } from './github-pat-store'

/**
 * Per-project GitHub account → GH_TOKEN materialization.
 *
 * Repos can pin a GitHub account (Repo.githubAccountRef). This module maps a
 * spawn cwd (repo primary path or any worktree of it) to that pin and yields
 * the account's token: `gh auth token --user` for gh keyring accounts, the
 * encrypted PAT file for stored tokens. Consumers inject the result as
 * GH_TOKEN into gh spawns (runner) and terminal PTYs.
 */

type GhTokenExec = (
  args: string[],
  options: { wslDistro?: string; skipAccountEnv?: boolean; env?: NodeJS.ProcessEnv }
) => Promise<{ stdout: string; stderr: string }>

let getReposSource: (() => Repo[]) | null = null
let ghTokenExec: GhTokenExec | null = null
let getPatAccountsSource: (() => GithubPatAccountMeta[]) | null = null

export function configureGithubAccountEnv(options: {
  getRepos: () => Repo[]
  ghExec: GhTokenExec
  getPatAccounts?: () => GithubPatAccountMeta[]
}): void {
  getReposSource = options.getRepos
  ghTokenExec = options.ghExec
  getPatAccountsSource = options.getPatAccounts ?? null
}

// ── cwd → account ref ────────────────────────────────────────────────

function normalizePathForMatch(path: string): string {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isPathWithin(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep)
}

function refForPath(path: string, pinned: { path: string; ref: string }[]): string | null {
  let best: { path: string; ref: string } | null = null
  for (const entry of pinned) {
    if (isPathWithin(path, entry.path) && (!best || entry.path.length > best.path.length)) {
      best = entry
    }
  }
  return best?.ref ?? null
}

/** Worktree dirs carry a `.git` pointer file (`gitdir: <repo>/.git/worktrees/x`);
 *  follow it so worktrees inherit their parent repo's account pin. */
function mainRepoPathFromWorktree(cwd: string): string | null {
  try {
    const raw = readFileSync(resolve(cwd, '.git'), 'utf-8')
    const match = raw.match(/^gitdir:\s*(.+)$/m)
    if (!match) {
      return null
    }
    const gitdir = match[1].trim()
    const marker = gitdir.replace(/\\/g, '/').indexOf('/.git/worktrees/')
    if (marker === -1) {
      return null
    }
    return gitdir.slice(0, marker)
  } catch {
    // Not a linked worktree (regular .git directory, or no cwd access).
    return null
  }
}

export function githubAccountRefForCwd(cwd: string | undefined): string | null {
  if (!cwd || !getReposSource) {
    return null
  }
  const pinned = getReposSource()
    .filter((repo): repo is Repo & { githubAccountRef: string } => Boolean(repo.githubAccountRef))
    .map((repo) => ({
      path: normalizePathForMatch(repo.path),
      ref: repo.githubAccountRef
    }))
  if (pinned.length === 0) {
    return null
  }
  const normalizedCwd = normalizePathForMatch(cwd)
  const direct = refForPath(normalizedCwd, pinned)
  if (direct) {
    return direct
  }
  const mainRepoPath = mainRepoPathFromWorktree(cwd)
  return mainRepoPath ? refForPath(normalizePathForMatch(mainRepoPath), pinned) : null
}

// ── token resolution + cache ─────────────────────────────────────────

const tokenCache = new Map<string, string>()
const tokenInFlight = new Map<string, Promise<string | null>>()

export function invalidateGithubAccountToken(ref: string): void {
  tokenCache.delete(ref)
  tokenInFlight.delete(ref)
  // Why: identity derives from the token's account; a stale/replaced token means
  // the cached name/email may belong to someone else now.
  identityCache.delete(ref)
  identityInFlight.delete(ref)
}

/** @internal - exposed for tests only */
export function _resetGithubAccountEnv(): void {
  tokenCache.clear()
  tokenInFlight.clear()
  identityCache.clear()
  identityInFlight.clear()
  getReposSource = null
  ghTokenExec = null
  getPatAccountsSource = null
}

async function fetchGhCliToken(
  ref: Extract<GithubAccountRef, { kind: 'gh-cli' }>
): Promise<string | null> {
  if (!ghTokenExec) {
    return null
  }
  try {
    const { stdout } = await ghTokenExec(
      ['auth', 'token', '--hostname', ref.host, '--user', ref.user],
      { skipAccountEnv: true }
    )
    const token = stdout.trim()
    return token || null
  } catch {
    // Account removed from gh's keyring, or gh missing — fall back to ambient auth.
    return null
  }
}

export async function resolveGithubAccountToken(refString: string): Promise<string | null> {
  const cached = tokenCache.get(refString)
  if (cached) {
    return cached
  }
  const inFlight = tokenInFlight.get(refString)
  if (inFlight) {
    return inFlight
  }
  const ref = parseGithubAccountRef(refString)
  if (!ref) {
    return null
  }
  const promise = (async () => {
    const token = ref.kind === 'pat' ? loadGithubPatTokenSafe(ref.id) : await fetchGhCliToken(ref)
    if (token) {
      tokenCache.set(refString, token)
    }
    return token
  })()
  tokenInFlight.set(refString, promise)
  try {
    return await promise
  } finally {
    tokenInFlight.delete(refString)
  }
}

function loadGithubPatTokenSafe(patId: string): string | null {
  try {
    return loadGithubPatToken(patId)
  } catch {
    // Decryption failure (keychain denied) — treat as no pin rather than failing every gh call.
    return null
  }
}

/** Async path for gh spawns: returns the token to inject, or null for ambient auth. */
export async function githubAccountTokenForCwd(cwd: string | undefined): Promise<{
  ref: string
  token: string
} | null> {
  const ref = githubAccountRefForCwd(cwd)
  if (!ref) {
    return null
  }
  const token = await resolveGithubAccountToken(ref)
  return token ? { ref, token } : null
}

export type GithubAccountGitCredential = { ref: string; token: string; host: string }

/** Async path for git network spawns: the pinned account's HTTPS credential plus
 *  the host it belongs to (helper config is URL-scoped), or null for ambient auth. */
export async function githubAccountGitCredentialForCwd(
  cwd: string | undefined
): Promise<GithubAccountGitCredential | null> {
  const refString = githubAccountRefForCwd(cwd)
  if (!refString) {
    return null
  }
  const parsed = parseGithubAccountRef(refString)
  if (!parsed) {
    return null
  }
  const token = await resolveGithubAccountToken(refString)
  if (!token) {
    return null
  }
  return { ref: refString, token, host: accountHostForRef(parsed) }
}

function accountHostForRef(parsed: GithubAccountRef): string {
  return parsed.kind === 'gh-cli'
    ? parsed.host
    : (getPatAccountsSource?.().find((account) => account.id === parsed.id)?.host ?? 'github.com')
}

// ── commit identity resolution + cache ───────────────────────────────

export type GithubAccountCommitIdentity = { name: string; email: string }

const identityCache = new Map<string, GithubAccountCommitIdentity>()
const identityInFlight = new Map<string, Promise<GithubAccountCommitIdentity | null>>()

async function fetchAccountCommitIdentity(
  refString: string
): Promise<GithubAccountCommitIdentity | null> {
  const parsed = parseGithubAccountRef(refString)
  if (!parsed || !ghTokenExec) {
    return null
  }
  const token = await resolveGithubAccountToken(refString)
  if (!token) {
    return null
  }
  try {
    const { stdout } = await ghTokenExec(['api', '--hostname', accountHostForRef(parsed), 'user'], {
      skipAccountEnv: true,
      env: { ...process.env, GH_TOKEN: token }
    })
    const user = JSON.parse(stdout) as {
      login?: unknown
      id?: unknown
      name?: unknown
      email?: unknown
    }
    const login = typeof user.login === 'string' && user.login ? user.login : null
    if (!login) {
      return null
    }
    const name = typeof user.name === 'string' && user.name.trim() ? user.name.trim() : login
    // Why: the id+login noreply form is the one GitHub maps to accounts created
    // after 2017; a public profile email wins when the user exposes one.
    const email =
      typeof user.email === 'string' && user.email
        ? user.email
        : typeof user.id === 'number'
          ? `${user.id}+${login}@users.noreply.github.com`
          : `${login}@users.noreply.github.com`
    return { name, email }
  } catch {
    // gh missing or API unreachable — commits fall back to the repo's git config.
    return null
  }
}

export async function resolveGithubAccountCommitIdentity(
  refString: string
): Promise<GithubAccountCommitIdentity | null> {
  const cached = identityCache.get(refString)
  if (cached) {
    return cached
  }
  const inFlight = identityInFlight.get(refString)
  if (inFlight) {
    return inFlight
  }
  const promise = (async () => {
    const identity = await fetchAccountCommitIdentity(refString)
    if (identity) {
      identityCache.set(refString, identity)
    }
    return identity
  })()
  identityInFlight.set(refString, promise)
  try {
    return await promise
  } finally {
    identityInFlight.delete(refString)
  }
}

/** Async path for git commit-creating spawns: the pinned account's author/committer
 *  identity, or null so git falls back to the repo's configured identity. */
export async function githubAccountCommitIdentityForCwd(
  cwd: string | undefined
): Promise<GithubAccountCommitIdentity | null> {
  const ref = githubAccountRefForCwd(cwd)
  if (!ref) {
    return null
  }
  return resolveGithubAccountCommitIdentity(ref)
}

/** Sync path for PTY spawns: only pre-warmed identities inject (spawn cannot await). */
export function cachedGithubAccountCommitIdentityForCwd(
  cwd: string | undefined
): GithubAccountCommitIdentity | null {
  const ref = githubAccountRefForCwd(cwd)
  if (!ref) {
    return null
  }
  const cached = identityCache.get(ref)
  if (!cached) {
    // Kick off resolution so the next spawn in this project hits the cache.
    void resolveGithubAccountCommitIdentity(ref)
  }
  return cached ?? null
}

/** Sync path for PTY spawns: only pre-warmed tokens inject (spawn cannot await). */
export function cachedGithubAccountTokenForCwd(cwd: string | undefined): string | null {
  const ref = githubAccountRefForCwd(cwd)
  if (!ref) {
    return null
  }
  const cached = tokenCache.get(ref)
  if (!cached) {
    // Kick off resolution so the next spawn in this project hits the cache.
    void resolveGithubAccountToken(ref)
  }
  return cached ?? null
}

/** Resolve every pinned account's token ahead of terminal spawns. */
export function prewarmGithubAccountTokens(): void {
  if (!getReposSource) {
    return
  }
  const refs = new Set<string>()
  for (const repo of getReposSource()) {
    if (repo.githubAccountRef) {
      refs.add(repo.githubAccountRef)
    }
  }
  for (const ref of refs) {
    void resolveGithubAccountToken(ref).then((token) => {
      if (token) {
        // Why: terminal spawns read identity synchronously; warm it with the token.
        void resolveGithubAccountCommitIdentity(ref)
      }
    })
  }
}
