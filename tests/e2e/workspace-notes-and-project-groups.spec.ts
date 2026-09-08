import { readFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { fileExplorerRowByName } from './helpers/file-explorer'
import { execInTerminal, waitForActivePanePtyId, waitForTerminalOutput } from './helpers/terminal'
import { projectGroupWorkspaceKey } from '../../src/shared/project-group-workspace'

test('merge smoke: notes persist through floating workspace close and reopen', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await orcaPage.evaluate(async () => {
    await window.__store!.getState().updateSettings({ floatingTerminalEnabled: true })
  })
  const toggle = orcaPage.locator('button[data-floating-terminal-toggle]')
  await toggle.click()
  const panel = orcaPage.locator('[data-floating-terminal-panel]')
  await expect(panel).toBeVisible()
  await panel.getByRole('tab', { name: 'Notes', exact: true }).click()
  const editor = panel.locator('.rich-markdown-editor')
  await expect(editor).toBeVisible({ timeout: 30_000 })
  const marker = 'Merge verification workspace notes'
  await editor.click()
  await orcaPage.keyboard.press('ControlOrMeta+End')
  await orcaPage.keyboard.press('Enter')
  await orcaPage.keyboard.type(marker)
  await orcaPage.keyboard.press('ControlOrMeta+S')
  const notesPath = await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    return state.openFiles.find((file) => file.workspaceNotesOwnerId === state.activeWorktreeId)
      ?.filePath
  })
  expect(notesPath).toBeTruthy()
  await expect.poll(() => readFileSync(notesPath!, 'utf8')).toContain(marker)
  await toggle.click()
  await expect(panel).toBeHidden()
  await toggle.click()
  await expect(editor).toContainText(marker)
  await orcaPage.screenshot({ path: testInfo.outputPath('workspace-notes.png') })
})

test('merge smoke: colored FontAwesome group selects its group-wide workspace', async ({
  orcaPage,
  testRepoPath
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  const groupId = await orcaPage.evaluate(async () => {
    const state = window.__store!.getState()
    state.setSidebarOpen(true)
    state.setGroupBy('repo')
    const group = await state.createProjectGroup('Merge verification group')
    if (!group) {
      throw new Error('Group creation failed')
    }
    await state.moveProjectToGroup(state.repos[0]!.id, group.id)
    return group.id
  })
  const header = orcaPage.locator(`[data-project-group-header-id="${groupId}"]`)
  await expect(header).toBeVisible()
  const title = header.getByText('Merge verification group', { exact: true })
  const initialColor = await title.evaluate((element) => getComputedStyle(element).color)
  await orcaPage.evaluate(async (id) => {
    await window.__store!.getState().updateProjectGroup(id, {
      icon: { type: 'fontawesome', name: 'rocket', style: 'solid' }
    })
  }, groupId)
  await expect(header.locator('svg.fill-current')).toBeVisible()
  await header.hover()
  await header.getByRole('button', { name: 'Group actions for Merge verification group' }).click()
  await orcaPage.getByRole('menuitem', { name: 'Customize icon and color' }).click()
  const appearance = orcaPage.getByRole('dialog', { name: 'Customize Group' })
  await expect(appearance).toBeVisible()
  await appearance
    .getByRole('button', { name: /^Use .* repo color$/ })
    .nth(1)
    .click()
  await appearance.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(appearance).toBeHidden()
  await expect
    .poll(() => title.evaluate((element) => getComputedStyle(element).color))
    .not.toBe(initialColor)
  const groupWorkspaceKey = projectGroupWorkspaceKey(groupId)
  const workspace = orcaPage.locator(`[data-worktree-id="${groupWorkspaceKey}"]`)
  await expect(workspace).toBeVisible()
  const frame = orcaPage.locator(`[data-project-group-frame$="${groupId}"]`)
  await expect(frame).toBeVisible()
  await title.click()
  await expect(workspace).toBeHidden()
  await expect(frame).toBeHidden()
  await title.click()
  await expect(workspace).toBeVisible()
  await expect(frame).toBeVisible()
  await workspace.click()
  await expect
    .poll(() => orcaPage.evaluate(() => window.__store!.getState().activeWorktreeId))
    .toBe(groupWorkspaceKey)
  await expect(fileExplorerRowByName(orcaPage, basename(testRepoPath))).toBeVisible()
  const ptyId = await waitForActivePanePtyId(orcaPage)
  await execInTerminal(orcaPage, ptyId, 'node -p "process.cwd()"')
  await waitForTerminalOutput(orcaPage, dirname(testRepoPath))
  await orcaPage.screenshot({ path: testInfo.outputPath('group-workspace.png') })
})
