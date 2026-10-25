import { cp, mkdir, readdir, rename, rm, rmdir, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { Store } from '../persistence'
import type { Repo } from '../../shared/repo-types'
import type {
  PreflightPrototypePromotionResult,
  PromotePrototypeArgs,
  PromotePrototypeResult,
  PrototypePromotionTarget
} from '../../shared/prototype-types'
import { isPathInsideOrEqual } from '../../shared/cross-platform-path'
import {
  isValidGithubAccountRefString,
  parseGithubAccountRef
} from '../../shared/github/github-account-ref'
import { gitExecFileAsync, ghExecFileAsync } from '../git/runner'
import { gitPush } from '../git/remote'
import { listWorktreesStrict } from '../git/worktree'
import { extractExecError } from '../github/gh-utils'
import { addLocalRepoFromPath } from '../ipc/repos/local-repo-registration'
import {
  findLocalPrototypeRepo,
  getPrototypesRoot,
  isInsidePrototypesRoot,
  isRegisteredRepoPath
} from './prototype-location'

const MOVE_RETRY_DELAYS_MS = [150, 400, 1000]

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? (error as NodeJS.ErrnoException).code
    : undefined
}

async function validatePromotionTarget(
  store: Store,
  sourcePath: string,
  { parentPath, name }: PrototypePromotionTarget
): Promise<{ targetPath: string } | { error: string }> {
  const trimmedName = name.trim()
  const trimmedParent = parentPath.trim()
  if (!trimmedName) {
    return { error: 'Name cannot be empty' }
  }
  if (/[\\/]/.test(trimmedName) || trimmedName === '.' || trimmedName === '..') {
    return { error: 'Name cannot contain slashes or be "." / ".."' }
  }
  if (!trimmedParent || !isAbsolute(trimmedParent)) {
    return { error: 'Destination must be an absolute path' }
  }
  const targetPath = join(trimmedParent, trimmedName)
  if (
    isPathInsideOrEqual(getPrototypesRoot(), targetPath) ||
    isPathInsideOrEqual(sourcePath, targetPath)
  ) {
    return { error: 'Choose a destination outside the prototypes folder' }
  }
  if (isRegisteredRepoPath(store, targetPath)) {
    return { error: 'A project is already registered at that location' }
  }
  try {
    const existing = await stat(targetPath)
    if (!existing.isDirectory() || (await readdir(targetPath)).length > 0) {
      return { error: `"${trimmedName}" already exists at this location and is not empty.` }
    }
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      return { error: `Cannot access destination: ${errorMessage(error)}` }
    }
  }
  return { targetPath }
}

export async function preflightPrototypePromotion(
  store: Store,
  args: PrototypePromotionTarget & { repoId: string }
): Promise<PreflightPrototypePromotionResult> {
  const repo = findLocalPrototypeRepo(store, args.repoId)
  if (!repo || !(await isInsidePrototypesRoot(repo.path))) {
    return { error: 'Prototype not found' }
  }
  const target = await validatePromotionTarget(store, repo.path, args)
  return 'error' in target ? target : { sourcePath: repo.path, targetPath: target.targetPath }
}

async function moveDirectory(sourcePath: string, targetPath: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(sourcePath, targetPath)
      return
    } catch (error) {
      const code = errorCode(error)
      if (code === 'EXDEV') {
        await cp(sourcePath, targetPath, {
          recursive: true,
          errorOnExist: true,
          force: false,
          verbatimSymlinks: true
        })
        await rm(sourcePath, { recursive: true, force: true, maxRetries: 3 })
        return
      }
      // Why: Windows holds directory handles briefly after the prototype's terminals exit.
      const retryable = code === 'EBUSY' || code === 'EPERM' || code === 'EACCES'
      const delay = MOVE_RETRY_DELAYS_MS[attempt]
      if (!retryable || delay === undefined) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

function toGithubRepoName(name: string): string {
  const slug = name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'prototype'
}

async function publishToGithub(
  targetPath: string,
  name: string,
  args: PromotePrototypeArgs
): Promise<{ url?: string; warning?: string }> {
  const parsedRef =
    args.githubAccountRef && isValidGithubAccountRefString(args.githubAccountRef)
      ? parseGithubAccountRef(args.githubAccountRef)
      : null
  const host = parsedRef?.kind === 'gh-cli' ? parsedRef.host : undefined
  let url: string | undefined
  try {
    // Why: no --push; gh's push ignores Orca's per-project credential, gitPush below honors it.
    const { stdout } = await ghExecFileAsync(
      [
        'repo',
        'create',
        toGithubRepoName(name),
        args.githubVisibility === 'public' ? '--public' : '--private',
        '--source',
        targetPath,
        '--remote',
        'origin'
      ],
      {
        cwd: targetPath,
        idempotent: false,
        ...(host && host !== 'github.com' ? { env: { ...process.env, GH_HOST: host } } : {})
      }
    )
    url = stdout.match(/https?:\/\/\S+/)?.[0]
  } catch (error) {
    const { stderr } = extractExecError(error)
    return { warning: `GitHub repository was not created: ${stderr.trim() || errorMessage(error)}` }
  }
  try {
    await gitPush(targetPath)
  } catch (error) {
    return {
      url,
      warning: `Created ${url ?? 'the GitHub repository'} but push failed: ${errorMessage(error)}`
    }
  }
  return { url }
}

/** Caller must have already unregistered the prototype and stopped its terminals. */
export async function promotePrototype(
  store: Store,
  args: PromotePrototypeArgs
): Promise<PromotePrototypeResult> {
  const sourcePath = args.sourcePath
  if (!(await isInsidePrototypesRoot(sourcePath)) || isRegisteredRepoPath(store, sourcePath)) {
    return { error: 'Prototype not found' }
  }
  const target = await validatePromotionTarget(store, sourcePath, args)
  if ('error' in target) {
    return { ...target, ...(await restorePrototype(store, args)) }
  }
  const { targetPath } = target
  const name = args.name.trim()
  const warnings: string[] = []

  const linkedWorktreePaths = await listWorktreesStrict(sourcePath)
    .then((worktrees) =>
      worktrees
        .filter((worktree) => !worktree.isMainWorktree && !worktree.isBare && !worktree.prunable)
        .map((worktree) => worktree.path)
    )
    .catch(() => [] as string[])

  try {
    await mkdir(args.parentPath.trim(), { recursive: true })
    // Why: rename cannot replace a directory on Windows, and validation already proved it empty.
    await rmdir(targetPath).catch(() => {})
    await moveDirectory(sourcePath, targetPath)
  } catch (error) {
    return {
      error: `Failed to move prototype: ${errorMessage(error)}`,
      ...(await restorePrototype(store, args))
    }
  }

  if (linkedWorktreePaths.length > 0) {
    try {
      // `git worktree repair` needs Git 2.29+; older hosts get a manual-recovery warning.
      await gitExecFileAsync(['worktree', 'repair', ...linkedWorktreePaths], { cwd: targetPath })
    } catch (error) {
      warnings.push(
        `Moved, but its other worktrees could not be relinked. Run "git worktree repair" in ${targetPath}. (${errorMessage(error)})`
      )
    }
  }

  const registered = await addLocalRepoFromPath(
    store,
    targetPath,
    'git',
    name,
    args.githubAccountRef && isValidGithubAccountRefString(args.githubAccountRef)
      ? { githubAccountRef: args.githubAccountRef }
      : {}
  )
  if ('error' in registered) {
    return {
      error: `Moved to ${targetPath}, but adding it as a project failed: ${registered.error}`
    }
  }

  let githubUrl: string | undefined
  if (args.publishToGithub) {
    const published = await publishToGithub(targetPath, name, args)
    githubUrl = published.url
    if (published.warning) {
      warnings.push(published.warning)
    }
  }
  return { repo: registered.repo, ...(githubUrl ? { githubUrl } : {}), warnings }
}

async function restorePrototype(
  store: Store,
  args: PromotePrototypeArgs
): Promise<{ restoredPrototype?: Repo }> {
  try {
    await stat(args.sourcePath)
  } catch {
    return {}
  }
  const restored = await addLocalRepoFromPath(
    store,
    args.sourcePath,
    'git',
    args.prototypeDisplayName,
    { isPrototype: true }
  )
  return 'error' in restored ? {} : { restoredPrototype: restored.repo }
}
