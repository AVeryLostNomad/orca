import { BoundedMap } from '../../../shared/bounded-map'
import type { GitBranchChangeEntry } from '../../../shared/git-diff-compare-types'
import { gitChangeListArgs, parseGitChangeList } from '../../../shared/git-change-list'
import type { GitRuntimeOptions } from '../git-runtime-options'
import { gitOptionsForWorktree } from '../git-runtime-options'
import { gitExecFileAsync } from '../runner'
import { MAX_GIT_SHOW_BYTES } from './git-show-max-bytes'

const FULL_COMMIT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

// Commit-to-commit change lists are immutable; branch-compare polls would otherwise re-diff them every pass.
const changeListCache = new BoundedMap<string, readonly GitBranchChangeEntry[]>({
  maxEntries: 64,
  maxBytes: 16_000_000,
  sizeOf: (entries) =>
    entries.reduce(
      (bytes, entry) => bytes + 64 + 2 * (entry.path.length + (entry.oldPath?.length ?? 0)),
      0
    )
})

function changeListCacheKey(
  worktreePath: string,
  parentOid: string | null,
  commitOid: string,
  options: GitRuntimeOptions
): string | undefined {
  if (
    !FULL_COMMIT_OID.test(commitOid) ||
    (parentOid !== null && !FULL_COMMIT_OID.test(parentOid))
  ) {
    return undefined
  }
  return `${options.wslDistro ?? ''}\0${worktreePath}\0${parentOid ?? ''}\0${commitOid}`
}

export async function loadBranchChanges(
  worktreePath: string,
  baseOid: string,
  headOid: string,
  options: GitRuntimeOptions = {}
): Promise<GitBranchChangeEntry[]> {
  return loadCommitChanges(worktreePath, baseOid, headOid, options)
}

export async function loadCommitChanges(
  worktreePath: string,
  parentOid: string | null,
  commitOid: string,
  options: GitRuntimeOptions = {}
): Promise<GitBranchChangeEntry[]> {
  const cacheKey = changeListCacheKey(worktreePath, parentOid, commitOid, options)
  const cached = cacheKey === undefined ? undefined : changeListCache.get(cacheKey)
  if (cached) {
    options.signal?.throwIfAborted()
    return cached.map((entry) => ({ ...entry }))
  }
  const { stdout } = await gitExecFileAsync(gitChangeListArgs(parentOid, commitOid), {
    ...gitOptionsForWorktree(worktreePath, options),
    maxBuffer: MAX_GIT_SHOW_BYTES
  })
  const entries = parseGitChangeList(stdout)
  if (cacheKey !== undefined) {
    changeListCache.set(
      cacheKey,
      entries.map((entry) => ({ ...entry }))
    )
  }
  return entries
}
