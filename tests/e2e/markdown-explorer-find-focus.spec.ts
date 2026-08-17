import { expect, test } from './helpers/orca-app'
import { fileExplorerRow, openFileExplorer } from './helpers/file-explorer'
import { pressShortcut } from './helpers/shortcuts'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test('Explorer-opened Markdown accepts the find shortcut without a document click', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await openFileExplorer(orcaPage)

  const readmeRow = fileExplorerRow(orcaPage, 'README.md')
  await expect(readmeRow).toBeVisible({ timeout: 10_000 })
  await readmeRow.focus()
  await readmeRow.click()

  await expect(orcaPage.locator('.rich-markdown-editor')).toBeVisible({ timeout: 25_000 })
  await pressShortcut(orcaPage, 'f')

  await expect(
    orcaPage.getByRole('textbox', { name: 'Find in rich markdown editor' })
  ).toBeVisible()
})
