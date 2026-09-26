import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { createRestartSession, attachRepoAndOpenTerminal } from './helpers/orca-restart'
import {
  cleanupGoldenWorktree,
  createGoldenWorktree,
  GOLDEN_CHANGED_PATH,
  openGoldenSourceControl,
  seedGoldenSourceEdit
} from './helpers/golden-source-control'
import { readWorkingDocument } from './helpers/editor-live-diff-lifetime'
import { waitForSessionReady } from './helpers/store'

test('@golden recovers an empty combined-only draft after workspace switching and quit/relaunch', async ({
  testRepoPath
}, testInfo) => {
  test.setTimeout(240_000)
  const fixture = createGoldenWorktree(testRepoPath, 'combined-draft-restart')
  seedGoldenSourceEdit(fixture.worktreePath)
  const filePath = realpathSync(path.join(fixture.worktreePath, GOLDEN_CHANGED_PATH))
  const diskContent = readFileSync(filePath, 'utf8')
  const session = createRestartSession(testInfo)
  let app: ElectronApplication | null = null

  try {
    const first = await session.launch()
    app = first.app
    await waitForSessionReady(first.page)
    await attachRepoAndOpenTerminal(first.page, testRepoPath)
    await openGoldenSourceControl(first.page, testRepoPath, fixture)
    const { worktreeId, otherId } = await first.page.evaluate((root) => {
      const state = window.__store!.getState()
      const worktreeId = state.activeWorktreeId
      const other = Object.values(state.worktreesByRepo)
        .flat()
        .find((worktree) => worktree.isMainWorktree)
      if (!worktreeId || !other || other.id === worktreeId) {
        throw new Error('Missing distinct workspaces for draft recovery')
      }
      state.openAllDiffs(worktreeId, root, undefined, 'unstaged')
      return { worktreeId, otherId: other.id }
    }, fixture.worktreePath)

    const modified = first.page.locator('.monaco-diff-editor .modified .monaco-editor').first()
    await expect(modified).toBeVisible({ timeout: 30_000 })
    await modified.click()
    await first.page.keyboard.press('ControlOrMeta+A')
    await first.page.keyboard.press('Backspace')
    await expect
      .poll(() => readWorkingDocument(first.page, filePath))
      .toMatchObject({
        content: '',
        isDirty: true,
        loadState: 'ready'
      })
    expect(
      await first.page.evaluate(
        (id) =>
          window
            .__store!.getState()
            .openFiles.filter((file) => file.worktreeId === id && file.mode === 'edit').length,
        worktreeId
      )
    ).toBe(0)
    expect(readFileSync(filePath, 'utf8')).toBe(diskContent)

    await first.page.locator(`[role="option"][data-worktree-id="${otherId}"]`).click()
    await expect
      .poll(() => first.page.evaluate(() => window.__store!.getState().activeWorktreeId))
      .toBe(otherId)
    await first.page.locator(`[role="option"][data-worktree-id="${worktreeId}"]`).click()
    await expect(modified).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(() => readWorkingDocument(first.page, filePath))
      .toMatchObject({ content: '', isDirty: true })
    expect(readFileSync(filePath, 'utf8')).toBe(diskContent)

    await session.close(app)
    app = null
    const second = await session.launch()
    app = second.app
    await waitForSessionReady(second.page)
    await expect(
      second.page.locator(`[role="option"][data-worktree-id="${worktreeId}"]`)
    ).toHaveAttribute('aria-current', 'page', { timeout: 30_000 })
    const restoredTab = second.page.getByTitle(filePath.replaceAll('\\', '/'), { exact: true })
    await expect(restoredTab).toBeVisible({ timeout: 30_000 })
    await restoredTab.click()
    const ordinary = second.page.locator('.monaco-editor').first()
    await expect(ordinary).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(() => readWorkingDocument(second.page, filePath))
      .toMatchObject({
        content: '',
        isDirty: true,
        loadState: 'ready'
      })
    expect(readFileSync(filePath, 'utf8')).toBe(diskContent)
    await ordinary.click()
    await second.page.keyboard.press('ControlOrMeta+S')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('')
    await expect
      .poll(() => readWorkingDocument(second.page, filePath))
      .toMatchObject({ content: '', isDirty: false })
    await second.page.screenshot({
      path: testInfo.outputPath('recovered-empty-combined-draft.png')
    })
  } finally {
    if (app) {
      await session.close(app).catch(() => undefined)
    }
    await session.dispose()
    cleanupGoldenWorktree(testRepoPath, fixture)
  }
})
