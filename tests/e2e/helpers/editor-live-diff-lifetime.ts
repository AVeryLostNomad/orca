import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { runProcess } from '../../../src/shared/child-process/run-process'
import { expect } from './orca-app'

const FIRST_PATH = 'src/live-diff-lifetime-00.ts'
const EMPTY_TRACKED_PATH = 'src/live-diff-lifetime-empty.ts'
const UNTRACKED_PATH = 'src/live-diff-lifetime-untracked.ts'
const FILE_COUNT = 18

function baselineFor(index: number): string {
  return `export const lifetime_${index} = 'baseline'\n`
}

function workingCopyFor(index: number): string {
  return `${baselineFor(index).replace('baseline', 'working')}${Array.from(
    { length: 220 },
    (_, line) => `export const lifetime_${index}_changed_${line} = ${index + line}\n`
  ).join('')}`
}

const FIRST_WORKING_COPY = workingCopyFor(0)

async function runGit(worktreePath: string, args: string[]): Promise<void> {
  const result = await runProcess({ program: 'git', args, cwd: worktreePath })
  if (result.code !== 0) {
    throw new Error(`Cannot seed live diff lifetime fixture: ${result.stderr}`)
  }
}

/** Seeds enough independently changed files to force the combined diff virtualizer to evict its first row. */
export async function seedLiveDiffLifetimeFixtures(worktreePath: string): Promise<void> {
  mkdirSync(path.join(worktreePath, 'src'), { recursive: true })

  for (let index = 0; index < FILE_COUNT; index += 1) {
    writeFileSync(
      path.join(worktreePath, `src/live-diff-lifetime-${String(index).padStart(2, '0')}.ts`),
      baselineFor(index)
    )
  }
  // An empty tracked file is deliberately committed as zero bytes; its later nonempty working copy
  // distinguishes a proven empty baseline from an unavailable read.
  writeFileSync(path.join(worktreePath, EMPTY_TRACKED_PATH), '')

  await runGit(worktreePath, [
    'add',
    '--',
    ...Array.from(
      { length: FILE_COUNT },
      (_, index) => `src/live-diff-lifetime-${String(index).padStart(2, '0')}.ts`
    ),
    EMPTY_TRACKED_PATH
  ])
  await runGit(worktreePath, [
    '-c',
    'core.hooksPath=',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'Seed live diff lifetime fixtures'
  ])

  for (let index = 0; index < FILE_COUNT; index += 1) {
    writeFileSync(
      path.join(worktreePath, `src/live-diff-lifetime-${String(index).padStart(2, '0')}.ts`),
      workingCopyFor(index)
    )
  }
  writeFileSync(path.join(worktreePath, EMPTY_TRACKED_PATH), 'export const emptyTracked = true\n')
  writeFileSync(path.join(worktreePath, UNTRACKED_PATH), 'export const untracked = true\n')
}

type WorkingDocumentSnapshot = {
  content: string | undefined
  isDirty: boolean
  loadState: string
} | null

export async function readWorkingDocument(
  page: Page,
  filePath: string
): Promise<WorkingDocumentSnapshot> {
  return page.evaluate((targetPath) => {
    const document = Object.values(window.__store!.getState().workingDocuments).find(
      (entry) => entry.target.filePath === targetPath
    )
    return document
      ? { content: document.content, isDirty: document.isDirty, loadState: document.loadState }
      : null
  }, filePath)
}

async function refreshStatusAndOpenCombinedDiff(page: Page, worktreePath: string): Promise<string> {
  return page.evaluate(async (targetWorktreePath) => {
    const store = window.__store!
    const state = store.getState()
    if (!state.activeWorktreeId) {
      throw new Error('No active worktree for lifetime combined diff')
    }
    const worktreeId = state.activeWorktreeId
    const status = await window.api.git.status({ worktreePath: targetWorktreePath })
    state.setGitStatus(worktreeId, status)
    const entries = status.entries.filter((entry) => entry.area === 'unstaged')
    state.openAllDiffs(worktreeId, targetWorktreePath, undefined, 'unstaged', entries)

    const nextState = store.getState()
    const activeGroupId = nextState.activeGroupIdByWorktree[worktreeId]
    const activeFileId = nextState.activeFileId
    const tab = (nextState.unifiedTabsByWorktree[worktreeId] ?? []).find(
      (candidate) => candidate.groupId === activeGroupId && candidate.entityId === activeFileId
    )
    if (!tab) {
      throw new Error('Combined diff tab was not created')
    }
    return tab.id
  }, worktreePath)
}

async function openOrdinaryEditor(page: Page, filePath: string): Promise<void> {
  await page.evaluate(
    ({ targetFilePath, relativePath }) => {
      const state = window.__store?.getState()
      if (!state?.activeWorktreeId) {
        throw new Error('No active worktree for lifetime ordinary editor')
      }
      state.openFile({
        filePath: targetFilePath,
        relativePath,
        worktreeId: state.activeWorktreeId,
        language: 'typescript',
        mode: 'edit'
      })
    },
    { targetFilePath: filePath, relativePath: FIRST_PATH }
  )
}

async function scrollFirstSectionOutOfViewport(page: Page, firstPath: string): Promise<void> {
  await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>('.combined-diff-scroll-container')
    if (!container) {
      throw new Error('Combined diff scroll container not found')
    }
    container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
    container.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  await expect(
    page.locator('[data-combined-diff-section-row]').filter({ hasText: path.basename(firstPath) })
  ).toHaveCount(0, { timeout: 20_000 })
}

async function exerciseEditableDiff(
  page: Page,
  worktreePath: string,
  relativePath: string,
  diskContent: string,
  marker: string
): Promise<void> {
  const row = page.locator(
    `[data-testid="source-control-entry"][data-source-control-path="${relativePath}"]`
  )
  await row.scrollIntoViewIfNeeded()
  await row.click()
  const modified = page.getByTestId('pierre-file-diff').locator('.monaco-editor')
  await expect(modified).toBeVisible({ timeout: 20_000 })
  await modified.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
  await page.keyboard.insertText(`\n${marker}`)
  await expect(modified).toContainText(marker)

  const filePath = path.join(worktreePath, relativePath)
  await expect
    .poll(() => readWorkingDocument(page, filePath))
    .toMatchObject({
      content: expect.stringContaining(marker),
      isDirty: true,
      loadState: 'ready'
    })
  expect(readFileSync(filePath, 'utf8')).toBe(diskContent)
}

export async function exerciseLiveDiffLifetime(page: Page, worktreePath: string): Promise<void> {
  const firstFilePath = path.join(worktreePath, FIRST_PATH)
  const draftMarker = `lifetime draft ${Date.now()}`
  const combinedTabId = await refreshStatusAndOpenCombinedDiff(page, worktreePath)
  const firstSection = page
    .locator('[data-combined-diff-section-row]')
    .filter({ hasText: path.basename(FIRST_PATH) })
  const modifiedPane = firstSection.locator('.monaco-editor')
  await expect(modifiedPane).toBeVisible({ timeout: 25_000 })
  await modifiedPane.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
  await page.keyboard.insertText(`\n${draftMarker}`)
  await expect(modifiedPane).toContainText(draftMarker)
  await expect
    .poll(() => readWorkingDocument(page, firstFilePath))
    .toMatchObject({
      content: expect.stringContaining(draftMarker),
      isDirty: true,
      loadState: 'ready'
    })
  expect(readFileSync(firstFilePath, 'utf8')).toBe(FIRST_WORKING_COPY)

  await scrollFirstSectionOutOfViewport(page, FIRST_PATH)
  await openOrdinaryEditor(page, firstFilePath)
  const ordinaryEditor = page.locator('.monaco-editor:visible').first()
  await expect
    .poll(async () => (await readWorkingDocument(page, firstFilePath))?.content)
    .toContain(draftMarker)
  await ordinaryEditor.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
  await expect(ordinaryEditor).toContainText(draftMarker, { timeout: 20_000 })

  await ordinaryEditor.click()
  let undoCount = 0
  await expect
    .poll(
      async () => {
        await page.keyboard.press('ControlOrMeta+Z')
        undoCount += 1
        return readWorkingDocument(page, firstFilePath)
      },
      { timeout: 20_000, intervals: [50] }
    )
    .toMatchObject({
      content: FIRST_WORKING_COPY,
      isDirty: false
    })
  for (let index = 0; index < undoCount; index += 1) {
    await page.keyboard.press('ControlOrMeta+Shift+Z')
  }
  await expect
    .poll(() => readWorkingDocument(page, firstFilePath))
    .toMatchObject({
      content: expect.stringContaining(draftMarker),
      isDirty: true
    })
  await expect(ordinaryEditor).toContainText(draftMarker)
  expect(readFileSync(firstFilePath, 'utf8')).toBe(FIRST_WORKING_COPY)

  // Close the now-inactive combined tab through its chrome. The ordinary editor remains a second
  // canonical membership, so this must neither prompt nor discard the shared dirty document.
  const combinedTab = page.locator(`[data-tab-id="${combinedTabId}"]`)
  await expect(combinedTab).toBeVisible()
  await combinedTab.hover()
  await combinedTab.getByRole('button', { name: 'Close tab' }).click()
  await expect(combinedTab).toHaveCount(0, { timeout: 10_000 })
  await expect(ordinaryEditor).toContainText(draftMarker)
  await expect
    .poll(() => readWorkingDocument(page, firstFilePath))
    .toMatchObject({
      content: expect.stringContaining(draftMarker),
      isDirty: true,
      loadState: 'ready'
    })
  expect(readFileSync(firstFilePath, 'utf8')).toBe(FIRST_WORKING_COPY)

  await exerciseEditableDiff(
    page,
    worktreePath,
    EMPTY_TRACKED_PATH,
    'export const emptyTracked = true\n',
    `empty tracked draft ${Date.now()}`
  )
  await exerciseEditableDiff(
    page,
    worktreePath,
    UNTRACKED_PATH,
    'export const untracked = true\n',
    `untracked draft ${Date.now()}`
  )
}
