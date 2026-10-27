import { existsSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { fileExplorerRow, openFileExplorer } from './helpers/file-explorer'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test('creates a file and a folder through the background menu inline rename', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await openFileExplorer(orcaPage)

  const worktreePath = await orcaPage.evaluate(() => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    const worktree = Object.values(state?.worktreesByRepo ?? {})
      .flat()
      .find((candidate) => candidate.id === worktreeId)
    if (!worktree) {
      throw new Error('active worktree unavailable')
    }
    return worktree.path
  })
  const createdName = 'created-via-menu.txt'
  const createdPath = path.join(worktreePath, createdName)
  rmSync(createdPath, { force: true })

  try {
    await expect(fileExplorerRow(orcaPage, 'README.md')).toBeVisible({ timeout: 10_000 })

    const pane = orcaPage.locator('[data-file-explorer-drop-dir]')
    const box = await pane.boundingBox()
    if (!box) {
      throw new Error('explorer pane not visible')
    }
    // Why: the terminal steals focus while the session finishes booting, which dismisses
    // non-modal menus; reopen until the item click lands.
    const chooseBackgroundMenuItem = (name: string) =>
      expect(async () => {
        await pane.click({ button: 'right', position: { x: box.width / 2, y: box.height - 12 } })
        await orcaPage.getByRole('menuitem', { name }).click({ timeout: 2_000 })
      }).toPass({ timeout: 15_000 })
    await chooseBackgroundMenuItem('New File')

    const renameInput = orcaPage.locator('file-tree-container input[data-item-rename-input]')
    await expect(renameInput).toBeVisible({ timeout: 5_000 })
    await renameInput.fill(createdName)
    await renameInput.press('Enter')

    await expect(fileExplorerRow(orcaPage, createdName)).toBeVisible({ timeout: 10_000 })
    await expect.poll(() => existsSync(createdPath), { timeout: 10_000 }).toBe(true)

    // New Folder via the background menu
    const folderName = 'created-folder'
    const folderPath = path.join(worktreePath, folderName)
    rmSync(folderPath, { recursive: true, force: true })
    await chooseBackgroundMenuItem('New Folder')
    const folderInput = orcaPage.locator('file-tree-container input[data-item-rename-input]')
    await expect(folderInput).toBeVisible({ timeout: 5_000 })
    await folderInput.fill(folderName)
    await folderInput.press('Enter')
    await expect(fileExplorerRow(orcaPage, `${folderName}/`)).toBeVisible({ timeout: 10_000 })
    await expect
      .poll(() => existsSync(folderPath) && statSync(folderPath).isDirectory(), {
        timeout: 10_000
      })
      .toBe(true)
    rmSync(folderPath, { recursive: true, force: true })
  } finally {
    rmSync(createdPath, { force: true })
    rmSync(path.join(worktreePath, 'created-folder'), { recursive: true, force: true })
  }
})
