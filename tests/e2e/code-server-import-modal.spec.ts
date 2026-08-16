/**
 * Embedded-editor config import: the repository settings entry opens the
 * import modal, detection round-trips through main-process IPC, and closing
 * without importing persists the first-run dismissal.
 *
 * Detection reads the real machine's editor dirs, so the modal legitimately
 * shows either detected editors or the empty state — the spec accepts both.
 */
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { getStoreState, waitForSessionReady } from './helpers/store'
import type { Repo } from '../../src/shared/repo-types'

async function openRepoSettings(page: Page, repoId: string): Promise<void> {
  await page.evaluate((repoId) => {
    const state = window.__store!.getState()
    state.openSettingsTarget({ pane: 'repo', repoId })
    state.openSettingsPage()
  }, repoId)
  await expect(page.getByPlaceholder('Search settings')).toBeVisible({ timeout: 10_000 })
  // Why: first-run announcements can cover the settings pane on fresh profiles.
  const maybeLaterButton = page.getByRole('button', { name: 'Maybe Later' })
  if (await maybeLaterButton.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await maybeLaterButton.click()
  }
}

test.describe('Code-server editor config import', () => {
  // The embedded editor (and therefore the import entry) is darwin/linux-only.
  test.skip(process.platform === 'win32', 'embedded editor is not offered on Windows')

  test('opens from repository settings and persists dismissal over IPC', async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)

    const repos = await getStoreState<Repo[]>(orcaPage, 'repos')
    expect(repos.length).toBeGreaterThan(0)
    const repo = repos[0]
    await openRepoSettings(orcaPage, repo.id)

    // Fresh isolated userData: nothing imported or dismissed yet.
    const initialState = await orcaPage.evaluate(() => window.api.codeServer.getImportState())
    expect(Array.isArray(initialState.sources)).toBe(true)
    expect(initialState.activeSourceId).toBeNull()
    expect(initialState.promptDismissed).toBe(false)

    const repoSection = orcaPage.locator(`[data-settings-section="repo-${repo.id}"]`)
    await repoSection.getByRole('button', { name: 'Import from VS Code / Cursor…' }).click()

    const dialog = orcaPage.getByRole('dialog')
    await expect(dialog.getByText('Use Your Editor Settings')).toBeVisible()
    // Machine-dependent: either detected editor rows or the empty state.
    if (initialState.sources.length > 0) {
      await expect(dialog.getByText(initialState.sources[0].name).first()).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeVisible()
    } else {
      await expect(
        dialog.getByText('No VS Code or Cursor configuration was found on this machine.')
      ).toBeVisible()
    }

    await dialog.getByRole('button', { name: 'Not Now' }).click()
    await expect(dialog).not.toBeVisible()

    // Closing without importing counts as dismissing the first-run prompt.
    await expect
      .poll(
        async () =>
          (await orcaPage.evaluate(() => window.api.codeServer.getImportState())).promptDismissed,
        { timeout: 5_000, message: 'dismissal was not persisted through IPC' }
      )
      .toBe(true)
  })
})
