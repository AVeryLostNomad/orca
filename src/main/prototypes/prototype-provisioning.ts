import { mkdir, rm } from 'node:fs/promises'
import type { Store } from '../persistence'
import type { Repo } from '../../shared/repo-types'
import { GIT_IDENTITY_MISSING_ERROR, initializeEmptyGitRepo } from '../git/initialize-empty-repo'
import { resolveGithubAuthorIdentity } from '../github/github-author-identity'
import { addLocalRepoFromPath } from '../ipc/repos/local-repo-registration'
import { allocatePrototypeSlot } from './prototype-location'

export async function createPrototype(store: Store): Promise<{ repo: Repo } | { error: string }> {
  let slot: { path: string; displayName: string }
  try {
    slot = await allocatePrototypeSlot(store)
    await mkdir(slot.path, { recursive: false })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { error: `Failed to create prototype folder: ${message}` }
  }

  let initError = await initializeEmptyGitRepo(slot.path, false)
  if (initError === GIT_IDENTITY_MISSING_ERROR) {
    // Why: prototypes are one-click, so borrow the signed-in gh identity instead of failing on a bare git config.
    const identity = await resolveGithubAuthorIdentity().catch(() => null)
    if (identity) {
      initError = await initializeEmptyGitRepo(slot.path, false, identity)
    }
  }
  if (initError) {
    await rm(slot.path, { recursive: true, force: true }).catch(() => {})
    return { error: initError }
  }

  const result = await addLocalRepoFromPath(store, slot.path, 'git', slot.displayName, {
    isPrototype: true
  })
  return 'error' in result ? result : { repo: result.repo }
}
