import { readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'

function normalizePathForMatch(path: string): string {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isPathWithin(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep)
}

function deepestRepoContaining<T extends { path: string }>(
  path: string,
  repos: readonly T[]
): T | null {
  let best: { normalized: string; repo: T } | null = null
  for (const repo of repos) {
    const normalized = normalizePathForMatch(repo.path)
    if (isPathWithin(path, normalized) && (!best || normalized.length > best.normalized.length)) {
      best = { normalized, repo }
    }
  }
  return best?.repo ?? null
}

/** Worktree dirs carry a `.git` pointer file (`gitdir: <repo>/.git/worktrees/x`);
 *  follow it so worktrees outside the repo resolve to their parent project. */
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

/** Maps a spawn cwd (repo primary path or any worktree of it) to the owning repo. */
export function findRepoForCwd<T extends { path: string }>(
  repos: readonly T[],
  cwd: string | undefined
): T | null {
  if (!cwd || repos.length === 0) {
    return null
  }
  const direct = deepestRepoContaining(normalizePathForMatch(cwd), repos)
  if (direct) {
    return direct
  }
  const mainRepoPath = mainRepoPathFromWorktree(cwd)
  return mainRepoPath ? deepestRepoContaining(normalizePathForMatch(mainRepoPath), repos) : null
}
