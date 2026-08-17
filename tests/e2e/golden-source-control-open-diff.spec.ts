import { realpathSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import {
  cleanupGoldenWorktree,
  createGoldenWorktree,
  GOLDEN_ADDED_LINE,
  GOLDEN_CHANGED_PATH,
  GOLDEN_REMOVED_LINE,
  openGoldenSourceControl,
  seedGoldenSourceEdit
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'

test('@golden opens an unstaged file diff from Source Control', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}) => {
  const fixture = createGoldenWorktree(testRepoPath, 'open-diff')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))

  await waitForSessionReady(orcaPage)
  await openGoldenSourceControl(orcaPage, testRepoPath, fixture)
  seedGoldenSourceEdit(fixture.worktreePath)

  const changedFile = orcaPage
    .locator('[data-testid="source-control-entry"]')
    .filter({ hasText: path.basename(GOLDEN_CHANGED_PATH) })
  await expect(changedFile).toBeVisible({ timeout: 15_000 })
  await changedFile.click()

  const pierreDiff = orcaPage.locator('[data-testid="pierre-file-diff"]')
  await expect(pierreDiff).toBeVisible({ timeout: 20_000 })
  // Why: @pierre/diffs renders into an open shadow root; Playwright CSS/text locators pierce it.
  await expect(
    pierreDiff
      .locator('[data-content] [data-line-type$="deletion"]')
      .filter({ hasText: GOLDEN_REMOVED_LINE })
      .first()
  ).toBeVisible()
  await expect(
    pierreDiff
      .locator('[data-content] [data-line-type$="addition"]')
      .filter({ hasText: GOLDEN_ADDED_LINE })
      .first()
  ).toBeVisible()
  await expect(orcaPage.locator('.editor-header-path').first()).toHaveAttribute(
    'title',
    `${realpathSync(path.join(fixture.worktreePath, GOLDEN_CHANGED_PATH))} (diff)`
  )

  const probe = orcaPage.getByRole('button', { name: /Source Control/ })
  await probe.focus()
  await expect(probe).toBeFocused()
})
