import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  cleanupGoldenWorktree,
  createGoldenWorktree,
  GOLDEN_CHANGED_PATH,
  openGoldenSourceControl,
  seedGoldenSourceEdit
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'
import { forwardRendererConsole } from './helpers/renderer-console-forwarding'
import {
  LIVE_DIFF_WHITESPACE_FIXTURES,
  LIVE_GUTTER_BASELINE,
  LIVE_GUTTER_CHANGED,
  LIVE_GUTTER_HEAD_COMMITTED,
  LIVE_GUTTER_HEAD_REFRESH_PATH,
  LIVE_GUTTER_HEAD_WORKTREE,
  LIVE_GUTTER_PATH,
  PIERRE_CONTEXT_FIXTURE,
  seedLiveDiffGutterFixtures,
  seedLiveDiffWhitespaceFixtures
} from './helpers/editor-live-diff-fixtures'
import { runProcess } from '../../src/shared/child-process/run-process'
import { exerciseLiveDiffLsp, seedLiveDiffLspFixtures } from './helpers/editor-live-diff-lsp'
import {
  exerciseLiveDiffNavigation,
  seedLiveDiffNavigationFixtures
} from './helpers/editor-live-diff-navigation'
import {
  exerciseLiveDiffLifetime,
  seedLiveDiffLifetimeFixtures
} from './helpers/editor-live-diff-lifetime'

type GutterCounts = {
  added: number
  deleted: number
  modified: number
}

async function readWorkingDocumentContent(
  page: Page,
  filePath: string
): Promise<string | undefined> {
  return page.evaluate(
    (targetPath) =>
      Object.values(window.__store!.getState().workingDocuments).find(
        (document) => document.target.filePath === targetPath
      )?.content,
    filePath
  )
}

async function getGutterCounts(page: Page): Promise<GutterCounts> {
  return {
    added: await page.locator('.orca-git-gutter-added').count(),
    deleted: await page.locator('.orca-git-gutter-deleted').count(),
    modified: await page.locator('.orca-git-gutter-modified').count()
  }
}

async function undoUntilContent(page: Page, filePath: string, expected: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.keyboard.press('ControlOrMeta+Z')
        return readWorkingDocumentContent(page, filePath)
      },
      { timeout: 20_000, intervals: [50] }
    )
    .toBe(expected)
}

async function refreshActiveGitStatus(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    const worktree = worktreeId
      ? Object.values(state.worktreesByRepo)
          .flat()
          .find((entry) => entry.id === worktreeId)
      : undefined
    if (!state || !worktree) {
      throw new Error('No active Git worktree to refresh')
    }
    state.setGitStatus(worktree.id, await window.api.git.status({ worktreePath: worktree.path }))
  })
}

async function runGit(worktreePath: string, args: string[]): Promise<string> {
  const result = await runProcess({ program: 'git', args, cwd: worktreePath })
  expect(result.code, result.stderr).toBe(0)
  return result.stdout
}

test('@golden retains a combined working diff document across collapse and an ordinary editor', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  forwardRendererConsole(orcaPage, testInfo)
  const fixture = createGoldenWorktree(testRepoPath, 'combined-live-diff')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  seedGoldenSourceEdit(fixture.worktreePath)
  const absoluteFilePath = realpathSync(path.join(fixture.worktreePath, GOLDEN_CHANGED_PATH))
  const sentinel = `Combined live draft ${Date.now()}`

  await waitForSessionReady(orcaPage)
  await openGoldenSourceControl(orcaPage, testRepoPath, fixture)
  await orcaPage.evaluate(async (worktreePath) => {
    const state = window.__store?.getState()
    if (!state?.activeWorktreeId) {
      throw new Error('No active worktree for combined diff')
    }
    await state.updateSettings({ combinedDiffFileTreeVisibleByDefault: true })
    state.openAllDiffs(state.activeWorktreeId, worktreePath)
  }, fixture.worktreePath)

  const section = orcaPage
    .locator('[data-combined-diff-section-row]')
    .filter({ hasText: 'index.ts' })
  const diffEditor = section.getByTestId('pierre-diff-section').first()
  await expect(diffEditor).toBeVisible({ timeout: 25_000 })
  const modifiedPane = diffEditor.locator('.monaco-editor')
  await modifiedPane.click()
  await orcaPage.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
  await orcaPage.keyboard.press('Enter')
  await orcaPage.keyboard.type(sentinel)
  await expect(modifiedPane).toContainText(sentinel)

  await section.locator('.sticky').first().click()
  await expect(section.locator('.monaco-editor')).toHaveCount(0)

  const navigatorRow = orcaPage.locator(`[data-combined-diff-tree-path="${GOLDEN_CHANGED_PATH}"]`)
  await navigatorRow.click()
  await expect(section.locator('.monaco-editor')).toContainText(sentinel)
  await navigatorRow.dblclick()
  await expect(orcaPage.getByTestId('pierre-diff-section')).toHaveCount(0)
  const ordinaryEditor = orcaPage.locator('.monaco-editor').first()
  await expect(ordinaryEditor).toContainText(sentinel, { timeout: 20_000 })
  await ordinaryEditor.click()
  await orcaPage.keyboard.press('ControlOrMeta+Z')
  await expect(ordinaryEditor).not.toContainText(sentinel)
  await orcaPage.keyboard.press('ControlOrMeta+Shift+Z')
  await expect(ordinaryEditor).toContainText(sentinel)
  await orcaPage.evaluate((worktreePath) => {
    const state = window.__store?.getState()
    if (!state?.activeWorktreeId) {
      throw new Error('No active worktree when reopening the combined diff')
    }
    state.openAllDiffs(state.activeWorktreeId, worktreePath)
  }, fixture.worktreePath)

  const restoredSection = orcaPage
    .locator('[data-combined-diff-section-row]')
    .filter({ hasText: 'index.ts' })
  const restoredModifiedPane = restoredSection.locator('.monaco-editor')
  await expect(restoredModifiedPane).toContainText(sentinel, { timeout: 20_000 })
  await restoredModifiedPane.click()
  await orcaPage.keyboard.press('ControlOrMeta+S')
  await expect
    .poll(() => readFileSync(absoluteFilePath, 'utf8'), { timeout: 15_000 })
    .toContain(sentinel)
})

test('@golden compares meaningful whitespace after an ordinary editor initializes Monaco first', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(150_000)
  forwardRendererConsole(orcaPage, testInfo)
  const comparisonErrors: string[] = []
  orcaPage.on('pageerror', (error) => comparisonErrors.push(error.message))
  const fixture = createGoldenWorktree(testRepoPath, 'semantic-whitespace')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  await seedLiveDiffWhitespaceFixtures(fixture.worktreePath)
  await waitForSessionReady(orcaPage)
  await openGoldenSourceControl(orcaPage, testRepoPath, fixture)
  await orcaPage.evaluate(
    async ({ filePath, relativePath }) => {
      const state = window.__store!.getState()
      await state.updateSettings({ diffShowWhitespace: false, editorAutoSave: false })
      state.openFile({
        filePath,
        relativePath,
        worktreeId: state.activeWorktreeId!,
        language: 'typescript',
        mode: 'edit'
      })
    },
    {
      filePath: path.join(fixture.worktreePath, GOLDEN_CHANGED_PATH),
      relativePath: GOLDEN_CHANGED_PATH
    }
  )
  await expect(orcaPage.locator('.monaco-editor').first()).toContainText('export const hello')

  for (const sample of LIVE_DIFF_WHITESPACE_FIXTURES) {
    await test.step(sample.name, async () => {
      const row = orcaPage.locator(
        `[data-testid="source-control-entry"][data-source-control-path="${sample.name}"]`
      )
      await row.scrollIntoViewIfNeeded()
      await row.click()
      await orcaPage.evaluate(() => {
        const state = window.__store!.getState()
        const file = state.openFiles.find((entry) => entry.id === state.activeFileId)
        if (file?.mode === 'diff' && file.language === 'markdown') {
          state.setMarkdownViewMode(file.id, 'source')
        }
      })
      const diff = orcaPage.getByTestId('pierre-file-diff')
      await expect(diff).toBeVisible({ timeout: 20_000 })
      const changes = diff.locator(
        '[data-content] [data-line-type$="addition"], [data-content] [data-line-type$="deletion"]'
      )
      const modified = diff.locator('.monaco-editor')
      if (sample.meaningful) {
        await expect(changes.first()).toBeVisible({ timeout: 15_000 })
      } else {
        // A substantive edit and undo prove the no-change state follows a completed live comparison.
        await modified.click()
        await orcaPage.keyboard.press('ControlOrMeta+A')
        await orcaPage.keyboard.insertText(`${sample.modified}\n// comparison probe`)
        await expect(modified).toContainText('// comparison probe')
        await expect(changes.first()).toBeVisible()
        await expect
          .poll(async () => {
            await orcaPage.keyboard.press('ControlOrMeta+Z')
            return orcaPage.evaluate(
              (filePath) =>
                Object.values(window.__store!.getState().workingDocuments).find(
                  (entry) => entry.target.filePath === filePath
                )?.content,
              path.join(fixture.worktreePath, sample.name)
            )
          })
          .toBe(sample.modified)
        await expect(changes).toHaveCount(0, { timeout: 15_000 })
      }
      await expect
        .poll(() =>
          orcaPage.evaluate(
            (filePath) => {
              const document = Object.values(window.__store!.getState().workingDocuments).find(
                (entry) => entry.target.filePath === filePath
              )
              return document?.content
            },
            path.join(fixture.worktreePath, sample.name)
          )
        )
        .toBe(sample.modified)

      if (sample.name === 'code-indent.ts') {
        await orcaPage.getByRole('button', { name: 'More actions', exact: true }).click()
        await orcaPage
          .getByRole('menuitemcheckbox', { name: 'Show Whitespace', exact: true })
          .click()
        await expect(changes.first()).toBeVisible({ timeout: 15_000 })
        await orcaPage.getByRole('button', { name: 'More actions', exact: true }).click()
        await orcaPage
          .getByRole('menuitemcheckbox', { name: 'Show Whitespace', exact: true })
          .click()
        await expect(changes).toHaveCount(0, { timeout: 15_000 })
      }
      if (sample.name === 'attributes.html' || sample.name === 'hard-break.md') {
        await testInfo.attach(`semantic-${sample.name}`, {
          body: await diff.screenshot(),
          contentType: 'image/png'
        })
      }
      expect(readFileSync(path.join(fixture.worktreePath, sample.name), 'utf8')).toBe(
        sample.modified
      )
    })
  }
  expect(comparisonErrors).toEqual([])
})

test('@golden keeps raw text, copy, and expanded context in semantic Pierre snapshots', async ({
  orcaPage,
  electronApp,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const fixture = createGoldenWorktree(testRepoPath, 'pierre-semantic')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  await seedLiveDiffWhitespaceFixtures(fixture.worktreePath)
  const staged = await runProcess({
    program: 'git',
    args: ['add', '--', PIERRE_CONTEXT_FIXTURE.name],
    cwd: fixture.worktreePath
  })
  expect(staged.code, staged.stderr).toBe(0)
  await waitForSessionReady(orcaPage)
  await openGoldenSourceControl(orcaPage, testRepoPath, fixture)
  await orcaPage.evaluate(() =>
    window.__store!.getState().updateSettings({ diffShowWhitespace: false })
  )
  await orcaPage
    .locator('[data-testid="source-control-entry"]')
    .filter({ hasText: PIERRE_CONTEXT_FIXTURE.name })
    .click()
  const diff = orcaPage.getByTestId('pierre-file-diff')
  await expect(diff).toBeVisible({ timeout: 20_000 })
  const additions = diff.locator('[data-content] [data-line-type$="addition"]')
  await expect(additions).toHaveCount(1)
  expect(await additions.textContent()).toContain('    export const n15 = 99  ')
  const firstLine = diff
    .locator('[data-content] [data-line]')
    .filter({ hasText: 'export const n0 = 0' })
  await expect(firstLine).toHaveCount(0)
  await diff.locator('[data-expand-button]').first().click()
  await expect(firstLine).toBeVisible()
  expect(await firstLine.textContent()).toContain('    export const n0 = 0  ')
  await testInfo.attach('pierre-semantic-expanded', {
    body: await diff.screenshot(),
    contentType: 'image/png'
  })

  const previousClipboard = await electronApp.evaluate(({ clipboard }) =>
    clipboard
      .availableFormats()
      .map((format) => ({ format, bytes: Array.from(clipboard.readBuffer(format)) }))
  )
  try {
    await orcaPage.getByRole('button', { name: 'Copy file contents', exact: true }).click()
    await expect
      .poll(() =>
        electronApp.evaluate(
          ({ clipboard }, expected) => clipboard.readText() === expected,
          PIERRE_CONTEXT_FIXTURE.modified
        )
      )
      .toBe(true)
  } finally {
    await electronApp.evaluate(
      ({ clipboard }, { previousClipboard, expected }) => {
        if (clipboard.readText() !== expected) {
          return
        }
        clipboard.clear()
        for (const entry of previousClipboard) {
          clipboard.writeBuffer(entry.format, Buffer.from(entry.bytes))
        }
      },
      { previousClipboard, expected: PIERRE_CONTEXT_FIXTURE.modified }
    )
  }
  expect(readFileSync(path.join(fixture.worktreePath, PIERRE_CONTEXT_FIXTURE.name), 'utf8')).toBe(
    PIERRE_CONTEXT_FIXTURE.modified
  )
  await expect(orcaPage.locator('.monaco-diff-editor')).toHaveCount(0)
})

test('@golden renders live ordinary-editor Git gutters through edits, emptying, undo, and both themes', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(120_000)
  const pageErrors: string[] = []
  orcaPage.on('pageerror', (error) => pageErrors.push(error.message))
  const fixture = createGoldenWorktree(testRepoPath, 'ordinary-git-gutter')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  await seedLiveDiffGutterFixtures(fixture.worktreePath)
  const absoluteFilePath = realpathSync(path.join(fixture.worktreePath, LIVE_GUTTER_PATH))

  await waitForSessionReady(orcaPage)
  await openGoldenSourceControl(orcaPage, testRepoPath, fixture)
  await orcaPage.evaluate(
    async ({ filePath, relativePath }) => {
      const state = window.__store!.getState()
      await state.updateSettings({ editorAutoSave: false, theme: 'light' })
      state.openFile({
        filePath,
        relativePath,
        worktreeId: state.activeWorktreeId!,
        language: 'typescript',
        mode: 'edit'
      })
    },
    { filePath: absoluteFilePath, relativePath: LIVE_GUTTER_PATH }
  )

  const editor = orcaPage.locator('.monaco-editor').first()
  await expect(editor).toContainText('export const second = 2', { timeout: 20_000 })
  await expect
    .poll(() => getGutterCounts(orcaPage))
    .toEqual({
      added: 0,
      deleted: 0,
      modified: 0
    })

  await editor.click()
  await orcaPage.keyboard.press('ControlOrMeta+A')
  await orcaPage.keyboard.insertText(LIVE_GUTTER_CHANGED)
  await expect
    .poll(() => readWorkingDocumentContent(orcaPage, absoluteFilePath))
    .toBe(LIVE_GUTTER_CHANGED)
  await expect
    .poll(async () => {
      const counts = await getGutterCounts(orcaPage)
      return counts.added >= 2 && counts.modified >= 1 && counts.deleted >= 1
    })
    .toBe(true)
  await testInfo.attach('ordinary-git-gutter-light', {
    body: await editor.screenshot({ path: testInfo.outputPath('ordinary-git-gutter-light.png') }),
    contentType: 'image/png'
  })

  await orcaPage.evaluate(async () => {
    await window.__store!.getState().updateSettings({ theme: 'dark' })
  })
  await expect(orcaPage.locator('html')).toHaveClass(/dark/)
  await testInfo.attach('ordinary-git-gutter-dark', {
    body: await editor.screenshot({ path: testInfo.outputPath('ordinary-git-gutter-dark.png') }),
    contentType: 'image/png'
  })

  // Sample every frame while typing into an already-marked line: marks must never blink out.
  await orcaPage.evaluate(() => {
    const samples: number[] = []
    const probe = { samples, stop: false }
    ;(window as unknown as { __gutterProbe: typeof probe }).__gutterProbe = probe
    const tick = (): void => {
      if (probe.stop) {
        return
      }
      samples.push(
        document.querySelectorAll('.orca-git-gutter-added, .orca-git-gutter-modified').length
      )
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await editor.click()
  await orcaPage.keyboard.press('ControlOrMeta+End')
  await orcaPage.keyboard.type('export const typing = 1', { delay: 40 })
  await expect
    .poll(() => readWorkingDocumentContent(orcaPage, absoluteFilePath))
    .toContain('export const typing = 1')
  await orcaPage.waitForTimeout(400)
  const frameSamples = await orcaPage.evaluate(() => {
    const probe = (window as unknown as { __gutterProbe: { samples: number[]; stop: boolean } })
      .__gutterProbe
    probe.stop = true
    return probe.samples
  })
  expect(frameSamples.length).toBeGreaterThan(10)
  expect(Math.min(...frameSamples)).toBeGreaterThan(0)
  await testInfo.attach('ordinary-git-gutter-typing-dark', {
    body: await editor.screenshot({
      path: testInfo.outputPath('ordinary-git-gutter-typing-dark.png')
    }),
    contentType: 'image/png'
  })

  await editor.click()
  await orcaPage.keyboard.press('ControlOrMeta+A')
  const withoutBoundaryLines = `${LIVE_GUTTER_BASELINE.split('\n').slice(1, -2).join('\n')}\n`
  await orcaPage.keyboard.insertText(withoutBoundaryLines)
  await expect
    .poll(() => readWorkingDocumentContent(orcaPage, absoluteFilePath))
    .toBe(withoutBoundaryLines)
  await expect(editor.locator('.orca-git-gutter-deleted-before')).toBeVisible()
  await expect(editor.locator('.orca-git-gutter-deleted-after')).toBeVisible()

  await editor.click()
  await orcaPage.keyboard.press('ControlOrMeta+A')
  await orcaPage.keyboard.press('Backspace')
  await expect.poll(() => readWorkingDocumentContent(orcaPage, absoluteFilePath)).toBe('')
  await expect(editor.locator('.view-lines .view-line')).toHaveCount(1)
  await expect(orcaPage.locator('.orca-git-gutter-deleted').first()).toBeVisible()
  await expect
    .poll(
      async () =>
        (await orcaPage
          .locator('.orca-git-gutter-deleted-before, .orca-git-gutter-deleted-after')
          .count()) > 0
    )
    .toBe(true)

  // Monaco can split one keyboard.insertText into word-level undo stops.
  await undoUntilContent(orcaPage, absoluteFilePath, LIVE_GUTTER_BASELINE)
  await expect
    .poll(() => getGutterCounts(orcaPage))
    .toEqual({
      added: 0,
      deleted: 0,
      modified: 0
    })
  expect(readFileSync(absoluteFilePath, 'utf8')).toBe(LIVE_GUTTER_BASELINE)
  expect(pageErrors).toEqual([])
})

test('@golden refreshes a dirty ordinary-editor gutter when HEAD changes without changing status shape', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}) => {
  test.setTimeout(120_000)
  const pageErrors: string[] = []
  orcaPage.on('pageerror', (error) => pageErrors.push(error.message))
  const fixture = createGoldenWorktree(testRepoPath, 'ordinary-gutter-head-refresh')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  await seedLiveDiffGutterFixtures(fixture.worktreePath)
  const absoluteFilePath = realpathSync(
    path.join(fixture.worktreePath, LIVE_GUTTER_HEAD_REFRESH_PATH)
  )
  const dirtyContent = `${LIVE_GUTTER_HEAD_COMMITTED}export const unsaved = true\n`

  writeFileSync(absoluteFilePath, LIVE_GUTTER_HEAD_COMMITTED)
  const statusBeforeHeadChange = await runGit(fixture.worktreePath, [
    'status',
    '--porcelain=v1',
    '--',
    LIVE_GUTTER_HEAD_REFRESH_PATH
  ])
  expect(statusBeforeHeadChange).toMatch(/^ M /)

  await waitForSessionReady(orcaPage)
  await openGoldenSourceControl(orcaPage, testRepoPath, fixture)
  await refreshActiveGitStatus(orcaPage)
  await orcaPage.evaluate(
    async ({ filePath, relativePath }) => {
      const state = window.__store!.getState()
      await state.updateSettings({ editorAutoSave: false })
      state.openFile({
        filePath,
        relativePath,
        worktreeId: state.activeWorktreeId!,
        language: 'typescript',
        mode: 'edit'
      })
    },
    { filePath: absoluteFilePath, relativePath: LIVE_GUTTER_HEAD_REFRESH_PATH }
  )
  const editor = orcaPage.locator('.monaco-editor').first()
  await expect(editor).toContainText('export const version = 2', { timeout: 20_000 })

  await editor.click()
  await orcaPage.keyboard.press('ControlOrMeta+A')
  await orcaPage.keyboard.insertText(dirtyContent)
  await expect.poll(() => readWorkingDocumentContent(orcaPage, absoluteFilePath)).toBe(dirtyContent)
  await expect
    .poll(async () => {
      const counts = await getGutterCounts(orcaPage)
      return counts.added >= 1 && counts.modified >= 1
    })
    .toBe(true)

  await runGit(fixture.worktreePath, ['add', '--', LIVE_GUTTER_HEAD_REFRESH_PATH])
  await runGit(fixture.worktreePath, [
    '-c',
    'core.hooksPath=',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'Advance ordinary editor gutter baseline'
  ])
  writeFileSync(absoluteFilePath, LIVE_GUTTER_HEAD_WORKTREE)
  expect(readFileSync(absoluteFilePath, 'utf8')).toBe(LIVE_GUTTER_HEAD_WORKTREE)
  const statusAfterHeadChange = await runGit(fixture.worktreePath, [
    'status',
    '--porcelain=v1',
    '--',
    LIVE_GUTTER_HEAD_REFRESH_PATH
  ])
  expect(statusAfterHeadChange).toBe(statusBeforeHeadChange)

  await refreshActiveGitStatus(orcaPage)
  await expect.poll(() => readWorkingDocumentContent(orcaPage, absoluteFilePath)).toBe(dirtyContent)
  await expect
    .poll(async () => {
      const counts = await getGutterCounts(orcaPage)
      return counts.added >= 1 && counts.modified === 0
    })
    .toBe(true)
  expect(pageErrors).toEqual([])
})

test('@golden does not show all-green Git gutters for a real plain-folder editor', async ({
  orcaPage,
  registerPostElectronShutdownCleanup
}) => {
  const pageErrors: string[] = []
  orcaPage.on('pageerror', (error) => pageErrors.push(error.message))
  const folderPath = mkdtempSync(path.join(tmpdir(), 'orca-e2e-plain-editor-'))
  const filePath = path.join(folderPath, 'plain-folder.ts')
  writeFileSync(filePath, 'export const plain = 1\n')
  registerPostElectronShutdownCleanup(async () =>
    rmSync(folderPath, { recursive: true, force: true })
  )

  await waitForSessionReady(orcaPage)
  await orcaPage.evaluate(
    async ({ filePath, folderPath }) => {
      const state = window.__store!.getState()
      const group = await state.createProjectGroup(`Plain folder gutter ${Date.now()}`)
      if (!group) {
        throw new Error('Could not create plain-folder project group')
      }
      const workspace = await state.createFolderWorkspace({
        projectGroupId: group.id,
        name: 'Plain folder gutter',
        folderPath
      })
      if (!workspace) {
        throw new Error('Could not create plain-folder workspace')
      }
      state.setActiveFolderWorkspace(workspace.id)
      await state.updateSettings({ editorAutoSave: false })
      state.openFile({
        filePath,
        relativePath: 'plain-folder.ts',
        worktreeId: `folder:${workspace.id}`,
        language: 'typescript',
        mode: 'edit'
      })
    },
    { filePath, folderPath }
  )

  const editor = orcaPage.locator('.monaco-editor').first()
  await expect(editor).toContainText('export const plain = 1', { timeout: 20_000 })
  await editor.click()
  await orcaPage.keyboard.press('ControlOrMeta+A')
  await orcaPage.keyboard.insertText('export const plain = 2\n')
  await expect
    .poll(() => readWorkingDocumentContent(orcaPage, filePath))
    .toBe('export const plain = 2\n')
  await expect
    .poll(async () => {
      const counts = await getGutterCounts(orcaPage)
      return counts.added + counts.modified + counts.deleted
    })
    .toBe(0)
  expect(pageErrors).toEqual([])
})

test('@golden routes current working files across review gestures and history', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}) => {
  test.setTimeout(150_000)
  const fixture = createGoldenWorktree(testRepoPath, 'live-diff-navigation')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  await seedLiveDiffNavigationFixtures(fixture.worktreePath)
  await waitForSessionReady(orcaPage)
  await openGoldenSourceControl(orcaPage, testRepoPath, fixture)
  await exerciseLiveDiffNavigation(orcaPage, fixture.worktreePath)
})

test('@golden retains canonical edits and undo through combined viewport eviction and close', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}) => {
  test.setTimeout(150_000)
  const fixture = createGoldenWorktree(testRepoPath, 'live-diff-lifetime')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  await seedLiveDiffLifetimeFixtures(fixture.worktreePath)
  await waitForSessionReady(orcaPage)
  await openGoldenSourceControl(orcaPage, testRepoPath, fixture)
  await exerciseLiveDiffLifetime(orcaPage, fixture.worktreePath)
})

test('@golden provides TypeScript language-server actions in ordinary and both Pierre diff views', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(240_000)
  forwardRendererConsole(orcaPage, testInfo)
  const fixture = createGoldenWorktree(testRepoPath, 'live-diff-lsp')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  await seedLiveDiffLspFixtures(fixture.worktreePath)
  await waitForSessionReady(orcaPage)
  await openGoldenSourceControl(orcaPage, testRepoPath, fixture)
  await exerciseLiveDiffLsp(orcaPage, fixture.worktreePath, (name) => testInfo.outputPath(name))
})
