import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { runProcess } from '../../../src/shared/child-process/run-process'
import { expect } from './orca-app'

const FIXTURE_ROOT = 'e2e-live-diff-navigation'
const MARKDOWN_PATH = `${FIXTURE_ROOT}/markdown-working.md`
const STAGED_PATH = `${FIXTURE_ROOT}/staged-working.ts`
const UNSTAGED_PATH = `${FIXTURE_ROOT}/unstaged-working.ts`
const UNTRACKED_PATH = `${FIXTURE_ROOT}/untracked-working.ts`
const RENAME_FROM_PATH = `${FIXTURE_ROOT}/rename-before.ts`
const RENAME_TO_PATH = `${FIXTURE_ROOT}/rename-current.ts`
const DELETED_PATH = `${FIXTURE_ROOT}/deleted-working.md`
const HISTORY_PATH = `${FIXTURE_ROOT}/history-current.ts`

const MARKDOWN_BASELINE = '# Markdown baseline\n'
const MARKDOWN_WORKING = '# Markdown current working copy\n'
const STAGED_BASELINE = 'export const staged = "baseline"\n'
const STAGED_WORKING = 'export const staged = "index current"\n'
const UNSTAGED_BASELINE = 'export const unstaged = "baseline"\n'
const UNSTAGED_WORKING = 'export const unstaged = "working current"\n'
const UNTRACKED_WORKING = 'export const untracked = "current on disk"\n'
const RENAME_BASELINE = 'export const renamed = "baseline"\n'
const RENAME_WORKING = 'export const renamed = "destination current"\n'
const DELETED_BASELINE = '# Deleted file must remain absent\n'
const HISTORY_OLD = 'export const history = "historical content"\n'
const HISTORY_CURRENT = 'export const history = "current working content"\n'
const HISTORY_SUBJECT = 'Advance live navigation history fixture'

async function runGit(worktreePath: string, args: string[]): Promise<void> {
  const result = await runProcess({ program: 'git', args, cwd: worktreePath })
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  }
}

function writeFixture(worktreePath: string, relativePath: string, content: string): void {
  const filePath = path.join(worktreePath, relativePath)
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
}

function displayPath(filePath: string): string {
  return filePath.replaceAll('\\', '/')
}

function sourceControlRow(
  page: Page,
  relativePath: string,
  area?: 'staged' | 'unstaged' | 'untracked'
) {
  const areaSelector = area ? `[data-source-control-area="${area}"]` : ''
  return page.locator(
    `[data-testid="source-control-entry"][data-source-control-path="${relativePath}"]${areaSelector}`
  )
}

async function expectDiffForCurrentContent(page: Page, expectedContent: string): Promise<void> {
  const diff = page
    .getByTestId('pierre-file-diff')
    .filter({ hasText: expectedContent.trim() })
    .first()
  await expect(diff).toBeVisible({ timeout: 20_000 })
}

async function expectOrdinaryWorkingFile(
  page: Page,
  absolutePath: string,
  expectedContent: string
): Promise<void> {
  await expect(page.getByTitle(displayPath(absolutePath), { exact: true })).toBeVisible()
  const visibleContent = absolutePath.endsWith('.md')
    ? page.getByRole('heading', { name: expectedContent.trim().replace(/^# /, ''), exact: true })
    : page.locator('.monaco-editor').filter({ hasText: expectedContent.trim() }).first()
  await expect(visibleContent).toBeVisible({ timeout: 20_000 })
  await expect
    .poll(() =>
      page.evaluate((filePath) => {
        const state = window.__store!.getState()
        const active = state.openFiles.find((file) => file.id === state.activeFileId)
        const document = Object.values(state.workingDocuments).find(
          (entry) => entry.target.filePath === filePath
        )
        return { mode: active?.mode, content: document?.content }
      }, absolutePath)
    )
    .toEqual({ mode: 'edit', content: expectedContent })
}

async function switchSourceControlView(
  page: Page,
  label: 'View as tree' | 'View as list'
): Promise<void> {
  await page.getByRole('button', { name: 'More source control actions' }).click()
  await page.getByRole('menuitem', { name: label }).click()
}

/**
 * Adds committed history plus staged, unstaged, untracked, renamed, and deleted working changes.
 * The caller owns the already-created disposable worktree and opens it only after this resolves.
 */
export async function seedLiveDiffNavigationFixtures(worktreePath: string): Promise<void> {
  writeFixture(worktreePath, MARKDOWN_PATH, MARKDOWN_BASELINE)
  writeFixture(worktreePath, STAGED_PATH, STAGED_BASELINE)
  writeFixture(worktreePath, UNSTAGED_PATH, UNSTAGED_BASELINE)
  writeFixture(worktreePath, RENAME_FROM_PATH, RENAME_BASELINE)
  writeFixture(worktreePath, DELETED_PATH, DELETED_BASELINE)
  writeFixture(worktreePath, HISTORY_PATH, HISTORY_OLD)
  await runGit(worktreePath, ['add', '--', FIXTURE_ROOT])
  await runGit(worktreePath, [
    '-c',
    'core.hooksPath=',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'Seed live navigation fixture'
  ])

  writeFixture(worktreePath, HISTORY_PATH, HISTORY_CURRENT)
  await runGit(worktreePath, ['add', '--', HISTORY_PATH])
  await runGit(worktreePath, [
    '-c',
    'core.hooksPath=',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    HISTORY_SUBJECT
  ])

  writeFixture(worktreePath, MARKDOWN_PATH, MARKDOWN_WORKING)
  writeFixture(worktreePath, STAGED_PATH, STAGED_WORKING)
  await runGit(worktreePath, ['add', '--', STAGED_PATH])
  writeFixture(worktreePath, UNSTAGED_PATH, UNSTAGED_WORKING)
  writeFixture(worktreePath, UNTRACKED_PATH, UNTRACKED_WORKING)
  await runGit(worktreePath, ['mv', '--', RENAME_FROM_PATH, RENAME_TO_PATH])
  writeFixture(worktreePath, RENAME_TO_PATH, RENAME_WORKING)
  rmSync(path.join(worktreePath, DELETED_PATH))
}

/** Exercises user gestures against the real Source Control list/tree/history surfaces. */
export async function exerciseLiveDiffNavigation(page: Page, worktreePath: string): Promise<void> {
  const markdownPath = realpathSync(path.join(worktreePath, MARKDOWN_PATH))
  const stagedPath = realpathSync(path.join(worktreePath, STAGED_PATH))
  const unstagedPath = realpathSync(path.join(worktreePath, UNSTAGED_PATH))
  const untrackedPath = realpathSync(path.join(worktreePath, UNTRACKED_PATH))
  const renamedPath = realpathSync(path.join(worktreePath, RENAME_TO_PATH))
  const deletedPath = path.join(worktreePath, DELETED_PATH)
  const historyPath = realpathSync(path.join(worktreePath, HISTORY_PATH))

  // List mode: the first click is a preview diff even for Markdown; the browser's second click
  // must not turn that preview into a second diff before dblclick opens the ordinary file.
  const markdownRow = sourceControlRow(page, MARKDOWN_PATH, 'unstaged')
  await expect(markdownRow).toBeVisible({ timeout: 20_000 })
  await markdownRow.click()
  await expectDiffForCurrentContent(page, MARKDOWN_WORKING)
  await expect(page.locator('.editor-header-path').first()).toHaveAttribute(
    'title',
    `${displayPath(markdownPath)} (diff)`
  )
  await markdownRow.dblclick()
  await expectOrdinaryWorkingFile(page, markdownPath, MARKDOWN_WORKING)
  expect(readFileSync(markdownPath, 'utf8')).toBe(MARKDOWN_WORKING)

  const stagedRow = sourceControlRow(page, STAGED_PATH, 'staged')
  await expect(stagedRow).toBeVisible()
  await stagedRow.click()
  await expectDiffForCurrentContent(page, STAGED_WORKING)
  await stagedRow.dblclick()
  await expectOrdinaryWorkingFile(page, stagedPath, STAGED_WORKING)
  expect(readFileSync(stagedPath, 'utf8')).toBe(STAGED_WORKING)

  const untrackedRow = sourceControlRow(page, UNTRACKED_PATH, 'untracked')
  await expect(untrackedRow).toBeVisible()
  await untrackedRow.click()
  await expectDiffForCurrentContent(page, UNTRACKED_WORKING)
  await untrackedRow.dblclick()
  await expectOrdinaryWorkingFile(page, untrackedPath, UNTRACKED_WORKING)
  expect(readFileSync(untrackedPath, 'utf8')).toBe(UNTRACKED_WORKING)
  // Staging is a real, non-destructive nested-row action: it must not steal the active editor.
  await untrackedRow.hover()
  await untrackedRow.getByRole('button', { name: 'Stage' }).click()
  await expect(sourceControlRow(page, UNTRACKED_PATH, 'staged')).toBeVisible({ timeout: 15_000 })
  await expectOrdinaryWorkingFile(page, untrackedPath, UNTRACKED_WORKING)
  expect(readFileSync(untrackedPath, 'utf8')).toBe(UNTRACKED_WORKING)

  // The tree/list toggle is the product setting. Reopen a nested staged rename from tree mode;
  // its working-file gesture must use the destination path, not the historical source path.
  await switchSourceControlView(page, 'View as tree')
  const renamedRow = sourceControlRow(page, RENAME_TO_PATH, 'staged')
  await expect(renamedRow).toBeVisible({ timeout: 15_000 })
  await renamedRow.click()
  await expectDiffForCurrentContent(page, RENAME_BASELINE)
  await renamedRow.dblclick()
  await expectOrdinaryWorkingFile(page, renamedPath, RENAME_WORKING)
  expect(existsSync(path.join(worktreePath, RENAME_FROM_PATH))).toBe(false)
  expect(readFileSync(renamedPath, 'utf8')).toBe(RENAME_WORKING)

  // A deleted source-control row remains a review diff after its working-file gesture. It must
  // not create an empty document or write the missing path back to disk.
  const deletedRow = sourceControlRow(page, DELETED_PATH, 'unstaged')
  await expect(deletedRow).toBeVisible()
  await deletedRow.click()
  const deletedDiff = page.getByTestId('pierre-file-diff').first()
  await expect(deletedDiff).toBeVisible({ timeout: 20_000 })
  await expect(deletedDiff).toContainText(DELETED_BASELINE.trim())
  await deletedRow.dblclick()
  await expect(page.locator('.editor-header-path').first()).toHaveAttribute(
    'title',
    `${displayPath(deletedPath)} (diff)`
  )
  await expect
    .poll(() =>
      page.evaluate(
        (filePath) =>
          Object.values(window.__store!.getState().workingDocuments).some(
            (document) => document.target.filePath === filePath
          ),
        deletedPath
      )
    )
    .toBe(false)
  expect(existsSync(deletedPath)).toBe(false)

  await switchSourceControlView(page, 'View as list')
  const unstagedRow = sourceControlRow(page, UNSTAGED_PATH, 'unstaged')
  await expect(unstagedRow).toBeVisible()
  const groupsBeforeModifierDoubleClick = await page.evaluate(() => {
    const state = window.__store!.getState()
    return state.activeWorktreeId
      ? (state.groupsByWorktree[state.activeWorktreeId] ?? []).length
      : 0
  })
  await unstagedRow.dblclick({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] })
  await expectOrdinaryWorkingFile(page, unstagedPath, UNSTAGED_WORKING)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = window.__store!.getState()
        return state.activeWorktreeId
          ? (state.groupsByWorktree[state.activeWorktreeId] ?? []).length
          : 0
      })
    )
    .toBe(groupsBeforeModifierDoubleClick + 1)
  expect(readFileSync(unstagedPath, 'utf8')).toBe(UNSTAGED_WORKING)

  // History file rows have their own open path and compare cache. Single click remains historical;
  // double click must instead open today's file and never substitute old committed text.
  const commits = page.getByRole('button', { name: 'Commits', exact: true })
  await expect(commits).toBeVisible()
  await commits.click()
  const historyCommit = page.getByTestId('git-history-row').filter({ hasText: HISTORY_SUBJECT })
  await expect(historyCommit).toBeVisible({ timeout: 20_000 })
  await historyCommit.click()
  const historyFile = page
    .getByTestId('git-history-commit-file')
    .filter({ hasText: path.basename(HISTORY_PATH) })
  await expect(historyFile).toHaveAttribute('title', HISTORY_PATH)
  await historyFile.click()
  const historyDiff = page
    .getByTestId('pierre-file-diff')
    .filter({ hasText: HISTORY_CURRENT.trim() })
    .first()
  await expect(historyDiff).toBeVisible({ timeout: 20_000 })
  await expect(historyDiff).toContainText(HISTORY_OLD.trim())
  await historyFile.dblclick()
  await expectOrdinaryWorkingFile(page, historyPath, HISTORY_CURRENT)
  expect(readFileSync(historyPath, 'utf8')).toBe(HISTORY_CURRENT)
}
