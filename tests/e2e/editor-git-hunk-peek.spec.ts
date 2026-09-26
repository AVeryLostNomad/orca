import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import type { Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  cleanupGoldenWorktree,
  createGoldenWorktree,
  openGoldenSourceControl
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'
import {
  LIVE_GUTTER_BASELINE,
  LIVE_GUTTER_CHANGED,
  LIVE_GUTTER_PATH,
  seedLiveDiffGutterFixtures
} from './helpers/editor-live-diff-fixtures'
import { readWorkingDocument } from './helpers/editor-live-diff-lifetime'

const peek = (page: Page): Locator => page.locator('.orca-git-hunk-peek')

async function expectEditorPalette(page: Page): Promise<void> {
  await expect
    .poll(() =>
      peek(page).evaluate((element) => {
        const editor = element.closest('.monaco-editor')!
        const panel = getComputedStyle(element)
        const editorStyle = getComputedStyle(editor)
        return (
          panel.backgroundColor === editorStyle.backgroundColor &&
          panel.color === editorStyle.color &&
          getComputedStyle(element.firstElementChild!).backgroundColor !== panel.backgroundColor &&
          panel.borderTopStyle === 'solid' &&
          panel.borderTopWidth === '1px'
        )
      })
    )
    .toBe(true)
}

async function clickGutterBarAt(page: Page, editor: Locator, lineNumber: number): Promise<void> {
  const cell = await editor
    .locator('.line-numbers')
    .filter({ hasText: new RegExp(`^${lineNumber}$`) })
    .first()
    .boundingBox()
  expect(cell).not.toBeNull()
  // The Git bar sits just right of the line numbers, inset 6px into the decorations lane.
  await page.mouse.click(cell!.x + cell!.width + 7, cell!.y + cell!.height / 2)
}

test('@golden opens an inline Git change peek from the gutter with navigation, dismissal, and revert', async ({
  orcaPage,
  electronApp,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(120_000)
  const pageErrors: string[] = []
  orcaPage.on('pageerror', (error) => pageErrors.push(error.message))
  const fixture = createGoldenWorktree(testRepoPath, 'git-hunk-peek')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  await seedLiveDiffGutterFixtures(fixture.worktreePath)
  const filePath = realpathSync(path.join(fixture.worktreePath, LIVE_GUTTER_PATH))

  await waitForSessionReady(orcaPage)
  await openGoldenSourceControl(orcaPage, testRepoPath, fixture)
  await orcaPage.evaluate(
    async ({ targetPath, relativePath }) => {
      const state = window.__store!.getState()
      await state.updateSettings({
        editorAutoSave: false,
        theme: 'dark',
        editorThemeDark: 'catppuccin-mocha'
      })
      state.openFile({
        filePath: targetPath,
        relativePath,
        worktreeId: state.activeWorktreeId!,
        language: 'typescript',
        mode: 'edit'
      })
    },
    { targetPath: filePath, relativePath: LIVE_GUTTER_PATH }
  )

  const editor = orcaPage.locator('.monaco-editor').first()
  await expect(editor).toContainText('export const second = 2', { timeout: 20_000 })
  await editor.click()
  await orcaPage.keyboard.press('ControlOrMeta+A')
  await orcaPage.keyboard.insertText(LIVE_GUTTER_CHANGED)
  await expect
    .poll(async () => (await readWorkingDocument(orcaPage, filePath))?.content)
    .toBe(LIVE_GUTTER_CHANGED)
  // Changes: added line 1, modified line 3, deletion before line 6, added line 11.
  await expect(editor.locator('.orca-git-gutter-modified')).toHaveCount(1, { timeout: 10_000 })

  // Clicking the modified bar opens its diff: removed baseline row, added working row, context.
  await clickGutterBarAt(orcaPage, editor, 3)
  await expect(peek(orcaPage)).toBeVisible()
  await expect(peek(orcaPage)).toContainText('2 of 4')
  await expect(peek(orcaPage).locator('[data-git-hunk-peek-row="removed"]')).toContainText(
    'export const second = 2'
  )
  await expect(peek(orcaPage).locator('[data-git-hunk-peek-row="added"]')).toContainText(
    'export const second = 20'
  )
  await expect(peek(orcaPage).locator('[data-git-hunk-peek-row="context"]').first()).toBeVisible()
  await expectEditorPalette(orcaPage)
  await testInfo.attach('git-hunk-peek-dark', {
    body: await editor.screenshot({ path: testInfo.outputPath('git-hunk-peek-dark.png') }),
    contentType: 'image/png'
  })
  await orcaPage.evaluate(async () => window.__store!.getState().updateSettings({ theme: 'light' }))
  await expect(orcaPage.locator('html')).not.toHaveClass(/dark/)
  await expectEditorPalette(orcaPage)
  await testInfo.attach('git-hunk-peek-light', {
    body: await editor.screenshot({ path: testInfo.outputPath('git-hunk-peek-light.png') }),
    contentType: 'image/png'
  })

  // Next/previous walk every change and wrap.
  await peek(orcaPage).getByRole('button', { name: 'Next change' }).click()
  await expect(peek(orcaPage)).toContainText('3 of 4')
  await expect(peek(orcaPage).locator('[data-git-hunk-peek-row="removed"]')).toContainText(
    'export const fifth = 5'
  )
  await expect(peek(orcaPage).locator('[data-git-hunk-peek-row="added"]')).toHaveCount(0)
  await peek(orcaPage).getByRole('button', { name: 'Next change' }).click()
  await expect(peek(orcaPage)).toContainText('4 of 4')
  await peek(orcaPage).getByRole('button', { name: 'Next change' }).click()
  await expect(peek(orcaPage)).toContainText('1 of 4')
  await peek(orcaPage).getByRole('button', { name: 'Previous change' }).click()
  await expect(peek(orcaPage)).toContainText('4 of 4')

  // Escape dismisses after focusing the editor text, and clicking code dismisses too.
  await editor.locator('.view-line').first().click()
  await expect(peek(orcaPage)).toHaveCount(0)
  await clickGutterBarAt(orcaPage, editor, 3)
  await expect(peek(orcaPage)).toBeVisible()
  await orcaPage.keyboard.press('Escape')
  await expect(peek(orcaPage)).toHaveCount(0)
  await clickGutterBarAt(orcaPage, editor, 3)
  await expect(peek(orcaPage)).toBeVisible()
  await peek(orcaPage).getByRole('button', { name: 'Close' }).click()
  await expect(peek(orcaPage)).toHaveCount(0)

  // Reverting restores only that change, stays in memory, and is one undo step.
  await clickGutterBarAt(orcaPage, editor, 3)
  await peek(orcaPage).getByRole('button', { name: 'Revert change' }).click()
  await expect(peek(orcaPage)).toHaveCount(0)
  const reverted = LIVE_GUTTER_CHANGED.replace('second = 20', 'second = 2')
  await expect
    .poll(async () => (await readWorkingDocument(orcaPage, filePath))?.content)
    .toBe(reverted)
  await expect(editor.locator('.orca-git-gutter-modified')).toHaveCount(0, { timeout: 10_000 })
  expect(readFileSync(filePath, 'utf8')).toBe(LIVE_GUTTER_BASELINE)
  await orcaPage.keyboard.press('ControlOrMeta+Z')
  await expect
    .poll(async () => (await readWorkingDocument(orcaPage, filePath))?.content)
    .toBe(LIVE_GUTTER_CHANGED)

  // A folding chevron shares the decorations lane; clicking it must fold, not peek.
  const withBlock = `${LIVE_GUTTER_CHANGED}export function block() {\n  return 1\n}\n`
  await editor.click()
  await orcaPage.keyboard.press('ControlOrMeta+A')
  // Paste, not typing, so Monaco's auto-indent does not reshape the block.
  await electronApp.evaluate(({ clipboard }, text) => clipboard.writeText(text), withBlock)
  await orcaPage.keyboard.press('ControlOrMeta+V')
  await expect
    .poll(async () => (await readWorkingDocument(orcaPage, filePath))?.content)
    .toBe(withBlock)
  const blockLine =
    withBlock.split('\n').findIndex((line) => line.startsWith('export function block')) + 1
  await expect
    .poll(() => editor.locator('.orca-git-gutter-added').count(), { timeout: 10_000 })
    .toBeGreaterThan(2)
  const chevronRow = editor
    .locator('.line-numbers')
    .filter({ hasText: new RegExp(`^${blockLine}$`) })
    .first()
  await chevronRow.hover()
  const chevron = editor.locator('.codicon-folding-expanded').first()
  await expect(chevron).toBeVisible()
  await chevron.click()
  await expect(editor.locator('.codicon-folding-collapsed')).toHaveCount(1)
  await expect(peek(orcaPage)).toHaveCount(0)
  expect(pageErrors).toEqual([])
})
