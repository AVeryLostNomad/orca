import { mkdir, readdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Store } from '../persistence'
import type { Repo } from '../../shared/repo-types'
import { getRepoRoutingConnectionId } from '../../shared/execution-host'
import {
  isPathInsideOrEqual,
  normalizeRuntimePathForComparison
} from '../../shared/cross-platform-path'

const PROTOTYPE_DIR_PREFIX = 'prototype-'

export function getPrototypesRoot(): string {
  return join(homedir(), 'orca', 'prototypes')
}

/** True only for a strict child of the prototypes root, after resolving symlinks. */
export async function isInsidePrototypesRoot(candidatePath: string): Promise<boolean> {
  try {
    const root = await realpath(getPrototypesRoot())
    const resolved = await realpath(candidatePath)
    return (
      isPathInsideOrEqual(root, resolved) &&
      normalizeRuntimePathForComparison(root) !== normalizeRuntimePathForComparison(resolved)
    )
  } catch {
    return false
  }
}

export function isRegisteredRepoPath(store: Store, path: string): boolean {
  const key = normalizeRuntimePathForComparison(path)
  return store
    .getRepos()
    .some(
      (repo) =>
        !getRepoRoutingConnectionId(repo) && normalizeRuntimePathForComparison(repo.path) === key
    )
}

export function findLocalPrototypeRepo(store: Store, repoId: string): Repo | null {
  return (
    store
      .getRepos()
      .find(
        (repo) =>
          repo.id === repoId && repo.isPrototype === true && !getRepoRoutingConnectionId(repo)
      ) ?? null
  )
}

/** Creates the root and returns the first free `prototype-N` slot. */
export async function allocatePrototypeSlot(
  store: Store
): Promise<{ path: string; displayName: string }> {
  const root = getPrototypesRoot()
  await mkdir(root, { recursive: true })
  const taken = new Set((await readdir(root)).map((entry) => entry.toLowerCase()))
  for (let index = 1; ; index++) {
    const dirName = `${PROTOTYPE_DIR_PREFIX}${index}`
    const path = join(root, dirName)
    if (!taken.has(dirName) && !isRegisteredRepoPath(store, path)) {
      return { path, displayName: `Prototype ${index}` }
    }
  }
}
