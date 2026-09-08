import { expect, type Page } from '@stablyai/playwright-test'
import { createSeededTestRepo, isValidGitRepo } from './seeded-test-repo'

export async function addSeededRepoAndWaitForRenderer(
  page: Page,
  seededRepoPath: string
): Promise<string> {
  const repoPath = isValidGitRepo(seededRepoPath) ? seededRepoPath : createSeededTestRepo()
  const seededRepoId = await page.evaluate(async (repoPath) => {
    const result = await window.api.repos.add({ path: repoPath })
    if ('error' in result) {
      throw new Error(result.error)
    }
    return result.repo.id
  }, repoPath)

  await expect
    .poll(
      () =>
        page.evaluate(async (repoId) => {
          const store = window.__store
          if (!store) {
            return false
          }
          await store.getState().fetchRepos()
          const repo = store.getState().repos.find((candidate) => candidate.id === repoId)
          if (!repo) {
            return false
          }
          await store.getState().updateRepo(repo.id, { externalWorktreeVisibility: 'show' })
          return true
        }, seededRepoId),
      {
        timeout: 30_000,
        message: `Expected e2e repo to be loaded: ${repoPath}`
      }
    )
    .toBe(true)

  return seededRepoId
}
