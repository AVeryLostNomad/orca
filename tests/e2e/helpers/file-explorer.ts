import type { Locator, Page } from '@stablyai/playwright-test'
import { expect } from '@stablyai/playwright-test'

/**
 * Locate a file-explorer tree row by its worktree-relative path.
 *
 * Why: the explorer renders through @pierre/trees ('file-tree-container' web
 * component with an open shadow root — standard locators pierce it). Rows
 * carry `data-item-path` with the POSIX worktree-relative path.
 */
export function fileExplorerRow(page: Page, relativePath: string): Locator {
  return page.locator(`file-tree-container [data-item-path="${relativePath}"]`)
}

/**
 * Row matched by basename when only the file name is known.
 *
 * Why: @pierre/trees splits names into truncation segments (stem/dot/ext,
 * each duplicated for overflow measurement), so textContent never contains
 * the contiguous file name. Rows expose the basename as aria-label instead.
 */
export function fileExplorerRowByName(page: Page, name: string): Locator {
  return page.locator(`file-tree-container [data-item-path][aria-label="${name}"]`)
}

/** Open the right sidebar file explorer and wait for store state to match. */
export async function openFileExplorer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window.__store
    if (!store) {
      return
    }

    const state = store.getState()
    // Why: hidden Electron runs do not reliably deliver Cmd/Ctrl+Shift+E or
    // expose the sidebar DOM in time for locator-based setup. Drive the same
    // store state the shortcut would update so file-open specs cover the
    // explorer workflow instead of hidden-window input timing.
    state.setRightSidebarTab('explorer')
    state.setRightSidebarOpen(true)
  })
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const state = window.__store?.getState()
          return Boolean(state?.rightSidebarOpen && state?.rightSidebarTab === 'explorer')
        }),
      { timeout: 3_000 }
    )
    .toBe(true)
}

/**
 * Open the first matching seeded file via the store.
 *
 * Why: the tests assert file-open behavior, not DOM tree rendering. Opening a
 * stable seeded file through the same editor store action avoids hidden-window
 * explorer DOM flakiness while still exercising Orca's editor tab model.
 */
export async function clickFileInExplorer(
  page: Page,
  candidates: string[]
): Promise<string | null> {
  return page.evaluate((candidateNames) => {
    const store = window.__store
    if (!store) {
      return null
    }

    const state = store.getState()
    const activeWorktreeId = state.activeWorktreeId
    if (!activeWorktreeId) {
      return null
    }

    const worktree = Object.values(state.worktreesByRepo)
      .flat()
      .find((entry) => entry.id === activeWorktreeId)
    if (!worktree) {
      return null
    }

    const separator = worktree.path.includes('\\') ? '\\' : '/'
    for (const fileName of candidateNames) {
      const filePath = `${worktree.path}${separator}${fileName}`
      state.openFile({
        filePath,
        relativePath: fileName,
        worktreeId: activeWorktreeId,
        language: fileName.endsWith('.md')
          ? 'markdown'
          : fileName.endsWith('.json')
            ? 'json'
            : fileName.endsWith('.ts')
              ? 'typescript'
              : 'plaintext',
        mode: 'edit'
      })
      return fileName
    }

    return null
  }, candidates)
}
