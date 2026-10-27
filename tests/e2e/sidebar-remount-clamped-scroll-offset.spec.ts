import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

// A remount seeds TanStack with the last scroll offset; when the new list cannot scroll that far,
// the stale offset used to pin a later header over row 0 and leave its own slot blank.
test('sidebar pins the first header after remounting onto a shorter list', async ({ orcaPage }) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  const sidebar = orcaPage.locator('[data-worktree-sidebar]')
  const scrollRange = (): Promise<number> =>
    sidebar.evaluate((el) => el.scrollHeight - el.clientHeight)
  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.setSidebarOpen(true)
    state.setGroupBy('repo')
  })
  // The window fills the display's work area, so add groups until the list overflows by > 300px.
  const groupIds: string[] = []
  while (groupIds.length < 150) {
    const batch = await orcaPage.evaluate(async (start) => {
      const ids: string[] = []
      for (let i = start; i < start + 30; i++) {
        const group = await window.__store!.getState().createProjectGroup(`Group ${i}`, 'local')
        ids.push(group!.id)
      }
      return ids
    }, groupIds.length)
    groupIds.push(...batch)
    const overflowed = await expect
      .poll(scrollRange, { timeout: 3_000 })
      .toBeGreaterThan(300)
      .then(
        () => true,
        () => false
      )
    if (overflowed) {
      break
    }
  }
  await expect.poll(scrollRange).toBeGreaterThan(300)
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
