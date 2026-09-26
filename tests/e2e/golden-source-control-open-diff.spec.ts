import { readFileSync, realpathSync } from 'node:fs'
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
import { forwardRendererConsole } from './helpers/renderer-console-forwarding'

test('@golden opens, edits, and saves an unstaged Pierre working diff', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  forwardRendererConsole(orcaPage, testInfo)
  const fixture = createGoldenWorktree(testRepoPath, 'open-diff')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  seedGoldenSourceEdit(fixture.worktreePath)
  const absoluteFilePath = realpathSync(path.join(fixture.worktreePath, GOLDEN_CHANGED_PATH))
  const sentinel = `Golden diff edit ${Date.now()}`

  await waitForSessionReady(orcaPage)
  await openGoldenSourceControl(orcaPage, testRepoPath, fixture)
  await orcaPage.evaluate(() =>
    window.__store!.getState().updateSettings({
      diffDefaultView: 'side-by-side',
      editorAutoSave: false
    })
  )

  const changedFile = orcaPage
    .locator('[data-testid="source-control-entry"]')
    .filter({ hasText: path.basename(GOLDEN_CHANGED_PATH) })
  await expect(changedFile).toBeVisible({ timeout: 15_000 })
  await changedFile.click()

  const diffEditor = orcaPage.getByTestId('pierre-file-diff')
  await expect(diffEditor).toBeVisible({ timeout: 20_000 })
  const originalPane = diffEditor.locator('[data-deletions] [data-content]').first()
  const modifiedPane = diffEditor.locator('.monaco-editor')
  await expect(originalPane).toContainText(GOLDEN_REMOVED_LINE)
  await expect(modifiedPane).toContainText(GOLDEN_ADDED_LINE)
  await expect(orcaPage.locator('.editor-header-path').first()).toHaveAttribute(
    'title',
    `${absoluteFilePath.replaceAll('\\', '/')} (diff)`
  )

  await expect(originalPane).not.toHaveAttribute('contenteditable', 'true')
  await expect(
    diffEditor.locator('[data-content] [data-line-type$="addition"]').first()
  ).toBeVisible()
  await modifiedPane.click()
  await orcaPage.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
  await orcaPage.keyboard.press('Enter')
  await orcaPage.keyboard.insertText(sentinel)
  await expect(modifiedPane).toContainText(sentinel)

  await expect(
    diffEditor.locator('[data-content] [data-line-type$="addition"]').filter({ hasText: sentinel })
  ).toBeVisible()
  await orcaPage.keyboard.press('ControlOrMeta+Z')
  await expect(modifiedPane).not.toContainText(sentinel)
  await orcaPage.keyboard.press('ControlOrMeta+Shift+Z')
  await expect(modifiedPane).toContainText(sentinel)
  await diffEditor.screenshot({ path: testInfo.outputPath('editable-diff-hunks.png') })
  const draft = await orcaPage.evaluate((filePath) => {
    const document = Object.values(window.__store!.getState().workingDocuments).find(
      (entry) => entry.target.filePath === filePath
    )
    if (!document) {
      throw new Error('No canonical document for the edited diff')
    }
    return { id: document.id, content: document.content }
  }, absoluteFilePath)
  expect(readFileSync(absoluteFilePath, 'utf8')).not.toContain(sentinel)
  await changedFile.dblclick()
  await expect(orcaPage.locator('.editor-header-path').first()).toHaveAttribute(
    'title',
    absoluteFilePath.replaceAll('\\', '/')
  )
  await expect
    .poll(() =>
      orcaPage.evaluate((filePath) => {
        const state = window.__store!.getState()
        const active = state.openFiles.find((entry) => entry.id === state.activeFileId)
        const document = Object.values(state.workingDocuments).find(
          (entry) => entry.target.filePath === filePath
        )
        return { mode: active?.mode, id: document?.id, content: document?.content }
      }, absoluteFilePath)
    )
    .toEqual({ mode: 'edit', ...draft })

  await expect(orcaPage.locator('.editor-header-path').first()).toContainText(GOLDEN_CHANGED_PATH)
  const ordinaryEditor = orcaPage.locator('.monaco-editor').first()
  await expect(ordinaryEditor).toContainText(sentinel, { timeout: 20_000 })
  await ordinaryEditor.click()
  await orcaPage.keyboard.press('ControlOrMeta+S')
  await expect
    .poll(() => readFileSync(absoluteFilePath, 'utf8'), { timeout: 15_000 })
    .toBe(draft.content)
})
