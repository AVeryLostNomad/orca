import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'
import { fileExplorerRow, fileExplorerRowByName } from './helpers/file-explorer'

test('preserves highlighted editor text across worktree tab switches', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}) => {
  const fixture = createGoldenWorktree(testRepoPath, 'editor-selection')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  await orcaPage.evaluate(() => {
    const state = window.__store?.getState()
    state?.setRightSidebarTab('explorer')
    state?.setRightSidebarOpen(true)
  })

  await fileExplorerRow(orcaPage, 'package.json').dblclick()
  const monaco = orcaPage.locator('.monaco-editor').first()
  await expect(monaco).toBeVisible({ timeout: 25_000 })
  await monaco.click()
  await orcaPage.keyboard.press('ControlOrMeta+f')
  const findInput = monaco.locator('.find-widget .input[aria-label="Find"]')
  await expect(findInput).toBeVisible()
  await findInput.fill('orca-e2e-test')
  await orcaPage.keyboard.press('Enter')
  await orcaPage.keyboard.press('Escape')

  await expect
    .poll(() => orcaPage.evaluate(() => window.__monacoEditorE2E?.snapshot().selection ?? null), {
      message: 'Monaco did not select the searched text'
    })
    .not.toBeNull()
  const selectedRange = await orcaPage.evaluate(
    () => window.__monacoEditorE2E?.snapshot().selection ?? null
  )
  if (!selectedRange) {
    throw new Error('Monaco selection disappeared before the tab switch')
  }
  expect([selectedRange.selectionStartLineNumber, selectedRange.selectionStartColumn]).not.toEqual([
    selectedRange.positionLineNumber,
    selectedRange.positionColumn
  ])
  if (process.env.ORCA_E2E_RECORD_VIDEO === '1') {
    await orcaPage.waitForTimeout(700)
  }

  await fileExplorerRowByName(orcaPage, 'src').click()
  await fileExplorerRow(orcaPage, 'src/index.ts').click()
  await expect(orcaPage.locator('.editor-header-path').first()).toContainText('index.ts', {
    timeout: 20_000
  })

  await orcaPage.locator('[data-tab-id]').filter({ hasText: 'package.json' }).last().click()
  await expect(orcaPage.locator('.editor-header-path').first()).toContainText('package.json', {
    timeout: 20_000
  })
  await expect
    .poll(() => orcaPage.evaluate(() => window.__monacoEditorE2E?.snapshot().selection ?? null))
    .toEqual(selectedRange)
  await expect(monaco.locator('.selected-text').first()).toBeVisible()
  if (process.env.ORCA_E2E_RECORD_VIDEO === '1') {
    await orcaPage.waitForTimeout(700)
  }
})
