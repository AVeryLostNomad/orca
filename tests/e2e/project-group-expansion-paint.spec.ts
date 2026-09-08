import { PNG } from 'pngjs'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

function countRedInk(buffer: Buffer): number {
  const { data } = PNG.sync.read(buffer)
  let count = 0
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset] > data[offset + 1] + 50 && data[offset] > data[offset + 2] + 50) {
      count++
    }
  }
  return count
}

test('group name and icon remain painted during expansion', async ({ orcaPage }, testInfo) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await orcaPage.emulateMedia({ reducedMotion: 'no-preference' })
  const groupId = await orcaPage.evaluate(async () => {
    const state = window.__store!.getState()
    state.setSidebarOpen(true)
    state.setGroupBy('repo')
    const group = await state.createProjectGroup('Expansion paint')
    if (!group) {
      throw new Error('Group creation failed')
    }
    await state.moveProjectToGroup(state.repos[0]!.id, group.id)
    await state.updateProjectGroup(group.id, {
      color: '#ef4444',
      icon: { type: 'fontawesome', name: 'rocket', style: 'solid' }
    })
    return group.id
  })
  const header = orcaPage.locator(`[data-project-group-header-id="${groupId}"]`)
  await expect(header.locator('svg.fill-current')).toBeVisible()
  await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'false')
  await expect(orcaPage.locator('html')).not.toHaveAttribute(
    'data-worktree-sidebar-group-transition'
  )
  const clip = (await header.boundingBox())!
  const baseline = countRedInk(await orcaPage.screenshot({ clip, scale: 'css' }))
  expect(baseline).toBeGreaterThan(100)

  // Freeze the actual browser snapshots late in expansion, when the new frame is opaque.
  await orcaPage.evaluate(async (id) => {
    const original = document.startViewTransition.bind(document)
    await new Promise<void>((resolve, reject) => {
      document.startViewTransition = ((callback: () => void) => {
        document.startViewTransition = original
        const transition = original(callback)
        void transition.ready.then(() => {
          for (const animation of document.getAnimations()) {
            if (
              (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith(
                '::view-transition'
              )
            ) {
              animation.pause()
              animation.currentTime = 160
            }
          }
          resolve()
        }, reject)
        return transition
      }) as typeof document.startViewTransition
      document.querySelector<HTMLElement>(`[data-project-group-header-id="${id}"]`)!.click()
    })
  }, groupId)
  const duringExpansion = countRedInk(
    await orcaPage.screenshot({
      clip: { ...clip, height: clip.height + 2 },
      scale: 'css',
      path: testInfo.outputPath('header-during-expansion.png')
    })
  )
  expect(duringExpansion).toBeGreaterThan(baseline * 0.8)
  await orcaPage.evaluate(() => {
    for (const animation of document.getAnimations()) {
      if (
        (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith('::view-transition')
      ) {
        animation.finish()
      }
    }
  })
  await expect(header).toHaveAttribute('aria-expanded', 'true')
})
