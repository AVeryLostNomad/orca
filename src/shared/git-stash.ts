/**
 * Git stash primitives shared by the local runner, WSL and the SSH relay: list,
 * inspect, push, apply and drop. Every step is a plain argv git call so the same
 * logic runs on every execution host. Commands stay within the Git 2.25
 * baseline (see docs/reference/git-compatibility.md); `stash push --staged`
 * (Git 2.35) is probed and falls back to a pathspec push.
 */
import type { GitBranchChangeEntry } from './git-diff-compare-types'
import type { GitBranchChangeStatus } from './git-status-types'

export type GitStashExec = (
  args: string[],
  cwd: string
) => Promise<{ stdout: string; stderr?: string }>

export type GitStashEntry = {
  /** Commit oid of the stash entry — stable even when the stash list reorders. */
  sha: string
  /** Reflog selector at list time, e.g. `stash@{0}`. */
  selector: string
  index: number
  /** The user-facing stash name (the subject without git's `On <branch>:` prefix). */
  message: string
  /** Branch the stash was taken on, when git recorded one in the subject. */
  branch: string | null
  timestamp: number
}

export type GitStashListResult = { stashes: GitStashEntry[] }

/** Which uncommitted area a stash push captures. */
export type GitStashPushScope = 'all' | 'staged' | 'unstaged' | 'untracked'

export type GitStashPushRequest = {
  message: string
  scope: GitStashPushScope
  /** The area's paths for the area-scoped kinds; ignored for `all`. */
  paths?: readonly string[]
}

export type GitStashPushResult =
  | { status: 'stashed'; sha: string }
  | { status: 'nothing-to-stash' }
  | { status: 'failed'; message: string }

export type GitStashApplyResult =
  /** Applied cleanly; the stash entry is kept. */
  | { status: 'applied' }
  /** Applied with merge conflicts to resolve in the worktree; the entry is kept as backup. */
  | { status: 'conflicts' }
  | { status: 'failed'; message: string }

export type GitStashDropResult =
  | { status: 'dropped' }
  | { status: 'not-found' }
  | { status: 'failed'; message: string }

export type GitStashFilesResult = { entries: GitBranchChangeEntry[] }

const STASH_FIELD_SEPARATOR = ''

export function describeGitStashError(error: unknown): string {
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
  exec: GitStashExec,
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

/** Git writes `WIP on <branch>: <sha> <subject>` or, with `-m`, `On <branch>: <message>`. */
export function parseGitStashSubject(subject: string): {
  branch: string | null
  message: string
} {
  const match = /^(?:WIP on|On) ([^:]+): (.*)$/s.exec(subject)
  if (!match) {
    return { branch: null, message: subject }
  }
  return { branch: match[1], message: match[2] }
}

export function parseGitStashList(stdout: string): GitStashEntry[] {
  const stashes: GitStashEntry[] = []
  for (const record of stdout.split('\0')) {
    if (!record.trim()) {
      continue
    }
    const [sha, selector, timestamp, subject = ''] = record.split(STASH_FIELD_SEPARATOR)
    if (!sha || !selector) {
      continue
    }
    const { branch, message } = parseGitStashSubject(subject.replace(/\r?\n$/, ''))
    const seconds = Number.parseInt(timestamp ?? '', 10)
    stashes.push({
      sha: sha.trim(),
      selector: selector.trim(),
      index: stashes.length,
      message,
      branch,
      timestamp: Number.isFinite(seconds) ? seconds * 1000 : 0
    })
  }
  return stashes
}

export async function listGitStashes(exec: GitStashExec, cwd: string): Promise<GitStashListResult> {
  // Why: refs/stash may not exist; `stash list` still exits 0 with no output.
  const { stdout } = await exec(
    [
      'stash',
      'list',
      '-z',
      `--format=%H${STASH_FIELD_SEPARATOR}%gd${STASH_FIELD_SEPARATOR}%ct${STASH_FIELD_SEPARATOR}%s`
    ],
    cwd
  )
  return { stashes: parseGitStashList(stdout) }
}

function parseNameStatusChar(char: string): GitBranchChangeStatus {
  switch (char) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    default:
      return 'modified'
  }
}

/** Parses `diff --name-status -z` output: `<status>\0<path>\0` with a second path for R/C. */
export function parseGitNameStatusZ(stdout: string): GitBranchChangeEntry[] {
  const tokens = stdout.split('\0')
  const entries: GitBranchChangeEntry[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const statusToken = tokens[i]
    if (!statusToken) {
      continue
    }
    const status = parseNameStatusChar(statusToken[0])
    if (status === 'renamed' || status === 'copied') {
      const oldPath = tokens[i + 1]
      const newPath = tokens[i + 2]
      i += 2
      if (newPath) {
        entries.push({ path: newPath, status, oldPath })
      }
      continue
    }
    const path = tokens[i + 1]
    i += 1
    if (path) {
      entries.push({ path, status })
    }
  }
  return entries
}

/** Files recorded in a stash: tracked changes against the stash base plus its untracked tree. */
export async function listGitStashFiles(
  exec: GitStashExec,
  cwd: string,
  sha: string
): Promise<GitStashFilesResult> {
  const { stdout } = await exec(
    ['diff-tree', '-r', '-z', '-M', '--name-status', '--no-commit-id', `${sha}^1`, sha],
    cwd
  )
  const entries = parseGitNameStatusZ(stdout)
  // Why: `stash push -u` records untracked files as a third parent tree.
  const untrackedTree = await revParseOptional(exec, cwd, `${sha}^3`)
  if (untrackedTree) {
    const untracked = await exec(['ls-tree', '-r', '-z', '--name-only', untrackedTree], cwd)
    for (const path of untracked.stdout.split('\0')) {
      if (path) {
        entries.push({ path, status: 'added' })
      }
    }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path))
  return { entries }
}

function isUnknownStagedOptionError(error: unknown): boolean {
  const text = describeGitStashError(error).toLowerCase()
  return text.includes('--staged') && (text.includes('unknown option') || text.includes('usage:'))
}

function literalPathspecs(paths: readonly string[]): string[] {
  return paths.map((path) => `:(literal)${path}`)
}

export async function pushGitStash(
  exec: GitStashExec,
  cwd: string,
  request: GitStashPushRequest
): Promise<GitStashPushResult> {
  const message = request.message.trim()
  const paths = request.paths ?? []
  if (request.scope !== 'all' && paths.length === 0) {
    return { status: 'nothing-to-stash' }
  }
  const stashBefore = await revParseOptional(exec, cwd, 'refs/stash')
  const messageArgs = message ? ['-m', message] : []
  try {
    switch (request.scope) {
      case 'all':
        await exec(['stash', 'push', '--include-untracked', ...messageArgs], cwd)
        break
      case 'staged':
        try {
          await exec(['stash', 'push', '--staged', ...messageArgs], cwd)
        } catch (error) {
          if (!isUnknownStagedOptionError(error)) {
            throw error
          }
          // Why: Git before 2.35 has no --staged; a pathspec push of the staged
          // files is the closest baseline equivalent (it also takes their
          // unstaged hunks). Not cached: this is a one-off user action.
          await exec(['stash', 'push', ...messageArgs, '--', ...literalPathspecs(paths)], cwd)
        }
        break
      case 'unstaged':
        // Why: --keep-index leaves the staged section intact so stashing "Changes"
        // never empties "Staged Changes" for files present in both areas.
        await exec(
          ['stash', 'push', '--keep-index', ...messageArgs, '--', ...literalPathspecs(paths)],
          cwd
        )
        break
      case 'untracked':
        await exec(
          [
            'stash',
            'push',
            '--include-untracked',
            ...messageArgs,
            '--',
            ...literalPathspecs(paths)
          ],
          cwd
        )
        break
    }
  } catch (error) {
    return { status: 'failed', message: describeGitStashError(error) }
  }
  // Why: compare stash refs instead of parsing "No local changes to save",
  // which is locale-dependent (and stash push exits 0 in that case).
  const stashSha = await revParseOptional(exec, cwd, 'refs/stash')
  if (!stashSha || stashSha === stashBefore) {
    return { status: 'nothing-to-stash' }
  }
  return { status: 'stashed', sha: stashSha }
}

async function hasUnmergedEntries(exec: GitStashExec, cwd: string): Promise<boolean> {
  try {
    const { stdout } = await exec(['ls-files', '-z', '--unmerged'], cwd)
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

export async function applyGitStash(
  exec: GitStashExec,
  cwd: string,
  sha: string
): Promise<GitStashApplyResult> {
  try {
    // Why: --index restores the staged/unstaged split; it refuses when the index
    // would conflict, so fall back to a plain apply rather than fail outright.
    await exec(['stash', 'apply', '--index', sha], cwd)
    return { status: 'applied' }
  } catch {
    // fall through to the plain apply
  }
  try {
    await exec(['stash', 'apply', sha], cwd)
    return { status: 'applied' }
  } catch (error) {
    if (await hasUnmergedEntries(exec, cwd)) {
      return { status: 'conflicts' }
    }
    return { status: 'failed', message: describeGitStashError(error) }
  }
}

/** Resolve the current reflog selector for a stash commit; the list may have shifted since it was shown. */
export async function findGitStashSelector(
  exec: GitStashExec,
  cwd: string,
  sha: string
): Promise<string | null> {
  const { stdout } = await exec(['stash', 'list', '--format=%H %gd'], cwd)
  for (const line of stdout.split('\n')) {
    const [entrySha, selector] = line.trim().split(' ')
    if (entrySha === sha && selector) {
      return selector
    }
  }
  return null
}

export async function dropGitStash(
  exec: GitStashExec,
  cwd: string,
  sha: string
): Promise<GitStashDropResult> {
  try {
    const selector = await findGitStashSelector(exec, cwd, sha)
    if (!selector) {
      return { status: 'not-found' }
    }
    await exec(['stash', 'drop', selector], cwd)
    return { status: 'dropped' }
  } catch (error) {
    return { status: 'failed', message: describeGitStashError(error) }
  }
}
