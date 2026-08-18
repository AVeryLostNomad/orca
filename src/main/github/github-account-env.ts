import { readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import type { Repo } from '../../shared/repo-types'
import {
  parseGithubAccountRef,
  type GithubAccountRef
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
  options: { wslDistro?: string; skipAccountEnv?: boolean }
) => Promise<{ stdout: string; stderr: string }>

let getReposSource: (() => Repo[]) | null = null
let ghTokenExec: GhTokenExec | null = null

export function configureGithubAccountEnv(options: {
  getRepos: () => Repo[]
  ghExec: GhTokenExec
}): void {
  getReposSource = options.getRepos
  ghTokenExec = options.ghExec
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
}

/** @internal - exposed for tests only */
export function _resetGithubAccountEnv(): void {
  tokenCache.clear()
  tokenInFlight.clear()
  getReposSource = null
  ghTokenExec = null
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
    void resolveGithubAccountToken(ref)
  }
}
