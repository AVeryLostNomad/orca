import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

// A remount seeds TanStack with the last scroll offset; when the new list cannot scroll that far,
// the stale offset used to pin a later header over row 0 and leave its own slot blank.
test('sidebar pins the first header after remounting onto a shorter list', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  const groupIds = await orcaPage.evaluate(async () => {
    const state = window.__store!.getState()
    state.setSidebarOpen(true)
    state.setGroupBy('repo')
    const ids: string[] = []
    for (let i = 0; i < 30; i++) {
      const group = await window.__store!.getState().createProjectGroup(`Group ${i}`)
      ids.push(group!.id)
    }
    return ids
  })
  const sidebar = orcaPage.locator('[data-worktree-sidebar]')
  await expect
    .poll(() => sidebar.evaluate((el) => el.scrollHeight - el.clientHeight))
    .toBeGreaterThan(300)
  await sidebar.evaluate((el) => {
    el.scrollTop = 300
  })
  await expect.poll(() => sidebar.evaluate((el) => el.scrollTop)).toBe(300)

  // Grouping mode is part of the viewport key, so this unmounts it while the list shrinks.
  await orcaPage.evaluate(() => window.__store!.getState().setGroupBy('none'))
  await orcaPage.evaluate(async (ids) => {
    for (const id of ids.slice(3)) {
      await window.__store!.getState().deleteProjectGroup(id)
    }
  }, groupIds)
  await orcaPage.evaluate(() => window.__store!.getState().setGroupBy('repo'))

  await expect.poll(() => sidebar.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true)
  await expect
    .poll(() =>
      sidebar.evaluate(
        (el) =>
          el.querySelector<HTMLElement>('[data-worktree-sticky-header-active]')?.dataset.index ??
          null
      )
    )
    .toBe('0')
})
