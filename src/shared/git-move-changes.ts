/**
 * Move all uncommitted changes (staged, unstaged, untracked) from one worktree
 * to another worktree of the same repository via a temporary stash commit.
 *
 * Why a stash: worktrees of one repo share the object database, so the stash
 * commit created in the source is directly applyable in the target with no
 * patch piping — every step is a plain argv git call, which keeps the exact
 * same logic runnable locally, through WSL, and on the SSH relay. All commands
 * used (`stash push -u`, `stash apply <sha>`, `ls-tree`, `ls-files`) are
 * within the Git 2.25 baseline (see docs/reference/git-compatibility.md).
 */

export type GitMoveChangesExec = (
  args: string[],
  cwd: string
) => Promise<{ stdout: string; stderr: string }>

export type GitMoveChangesResult =
  /** Everything applied cleanly in the target and the source is clean. */
  | { status: 'moved' }
  /** The source worktree had no uncommitted changes. */
  | { status: 'nothing-to-move' }
  /**
   * Changes were applied into the target but with merge conflicts to resolve
   * there. A backup stash entry is kept in the repo's stash list.
   */
  | { status: 'conflicts' }
  /** Nothing was changed anywhere; the source worktree was restored as it was. */
  | { status: 'blocked'; message: string }
  /** Unexpected failure; the changes are preserved in the repo's stash list. */
  | { status: 'failed'; message: string }

const PATHSPEC_CHUNK_SIZE = 100

function describeGitError(error: unknown): string {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    for (const field of ['stderr', 'stdout']) {
      const value = record[field]
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }
  }
  return error instanceof Error ? error.message : String(error)
}

async function revParseOptional(
  exec: GitMoveChangesExec,
  cwd: string,
  ref: string
): Promise<string | null> {
  try {
    const { stdout } = await exec(['rev-parse', '--quiet', '--verify', ref], cwd)
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function listStashUntrackedPaths(
  exec: GitMoveChangesExec,
  cwd: string,
  untrackedTree: string
): Promise<string[]> {
  const { stdout } = await exec(['ls-tree', '-r', '-z', '--name-only', untrackedTree], cwd)
  return stdout.split('\0').filter(Boolean)
}

/** Paths that already exist in the target as tracked files or on disk. */
async function findTargetCollisions(
  exec: GitMoveChangesExec,
  targetPath: string,
  paths: readonly string[]
): Promise<string[]> {
  const collisions = new Set<string>()
  for (let i = 0; i < paths.length; i += PATHSPEC_CHUNK_SIZE) {
    const chunk = paths.slice(i, i + PATHSPEC_CHUNK_SIZE)
    const { stdout } = await exec(
      ['ls-files', '-z', '--cached', '--others', '--', ...chunk.map((p) => `:(literal)${p}`)],
      targetPath
    )
    for (const existing of stdout.split('\0')) {
      if (existing) {
        collisions.add(existing)
      }
    }
  }
  return paths.filter((p) => collisions.has(p))
}

/** Drop the moved entry from the stash list; best-effort — a stray entry is recoverable. */
async function dropStashEntry(
  exec: GitMoveChangesExec,
  cwd: string,
  stashSha: string
): Promise<void> {
  try {
    const { stdout } = await exec(['stash', 'list', '--format=%H %gd'], cwd)
    for (const line of stdout.split('\n')) {
      const [sha, selector] = line.trim().split(' ')
      if (sha === stashSha && selector) {
        await exec(['stash', 'drop', selector], cwd)
        return
      }
    }
  } catch {
    // Why: dropping is cleanup only — the move already succeeded (or the
    // source was restored); a leftover stash entry is harmless and visible.
  }
}

/** Put the just-stashed changes back into the source worktree. */
async function restoreSource(
  exec: GitMoveChangesExec,
  sourcePath: string,
  stashSha: string
): Promise<boolean> {
  try {
    // Why: --index restores the staged/unstaged split exactly as it was.
    await exec(['stash', 'apply', '--index', stashSha], sourcePath)
  } catch {
    try {
      await exec(['stash', 'apply', stashSha], sourcePath)
    } catch {
      return false
    }
  }
  await dropStashEntry(exec, sourcePath, stashSha)
  return true
}

async function targetHasUnmergedEntries(
  exec: GitMoveChangesExec,
  targetPath: string
): Promise<boolean> {
  try {
    const { stdout } = await exec(['ls-files', '-z', '--unmerged'], targetPath)
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

export async function moveChangesBetweenWorktrees(
  exec: GitMoveChangesExec,
  sourcePath: string,
  targetPath: string
): Promise<GitMoveChangesResult> {
  const stashBefore = await revParseOptional(exec, sourcePath, 'refs/stash')
  try {
    await exec(
      ['stash', 'push', '--include-untracked', '-m', 'Orca: moving changes to another worktree'],
      sourcePath
    )
  } catch (error) {
    return { status: 'blocked', message: describeGitError(error) }
  }
  // Why: compare stash refs instead of parsing "No local changes to save",
  // which is locale-dependent (and stash push exits 0 in that case).
  const stashSha = await revParseOptional(exec, sourcePath, 'refs/stash')
  if (!stashSha || stashSha === stashBefore) {
    return { status: 'nothing-to-move' }
  }

  const blockAndRestore = async (message: string): Promise<GitMoveChangesResult> => {
    if (!(await restoreSource(exec, sourcePath, stashSha))) {
      return {
        status: 'failed',
        message: `${message} The changes are preserved in the git stash.`
      }
    }
    return { status: 'blocked', message }
  }

  // Why: `stash apply <sha>` in the target only works when both worktrees
  // share one object database — i.e. they belong to the same repository.
  try {
    await exec(['cat-file', '-e', `${stashSha}^{commit}`], targetPath)
  } catch {
    return blockAndRestore('The target worktree does not belong to the same repository.')
  }

  // Why: pre-check untracked collisions so `stash apply` never half-applies —
  // it restores untracked files and merges tracked ones in one command.
  const untrackedTree = await revParseOptional(exec, sourcePath, `${stashSha}^3`)
  if (untrackedTree) {
    const untrackedPaths = await listStashUntrackedPaths(exec, sourcePath, untrackedTree)
    const collisions = await findTargetCollisions(exec, targetPath, untrackedPaths)
    if (collisions.length > 0) {
      const sample = collisions.slice(0, 3).join(', ')
      const more = collisions.length > 3 ? `, +${collisions.length - 3} more` : ''
      return blockAndRestore(`Files already exist in the target worktree: ${sample}${more}.`)
    }
  }

  try {
    await exec(['stash', 'apply', stashSha], targetPath)
  } catch (error) {
    if (await targetHasUnmergedEntries(exec, targetPath)) {
      // Why: the merge landed with conflict markers in the target; keep the
      // stash as the intact backup and do NOT re-apply into the source, or the
      // same changes would exist in two working trees at once.
      return { status: 'conflicts' }
    }
    return blockAndRestore(describeGitError(error))
  }

  await dropStashEntry(exec, sourcePath, stashSha)
  return { status: 'moved' }
}
