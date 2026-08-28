import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActiveTerminalManager, waitForPaneCount } from './helpers/terminal'

test.describe('Popup terminal', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    const hasPaneManager = await waitForActiveTerminalManager(orcaPage, 30_000)
      .then(() => true)
      .catch(() => false)
    test.skip(
      !hasPaneManager,
      'Electron automation in this environment never mounts the live TerminalPane manager.'
    )
    await waitForPaneCount(orcaPage, 1, 30_000)
  })

  test('new-tab menu and repeated shortcut toggle an ephemeral terminal', async ({
    orcaPage,
    electronApp
  }) => {
    const initialTabCount = await orcaPage.evaluate(() => {
      const state = window.__store?.getState()
      return state?.activeWorktreeId
        ? (state.tabsByWorktree[state.activeWorktreeId]?.length ?? 0)
        : 0
    })

    await orcaPage.getByRole('button', { name: 'New tab' }).click()
    await orcaPage.getByRole('menuitem', { name: /New Popup Terminal/ }).click()
    await expect(orcaPage.getByRole('dialog', { name: 'Popup Terminal' })).toBeVisible()
    expect(
      await orcaPage.evaluate(() => {
        const state = window.__store?.getState()
        return state?.activeWorktreeId
          ? (state.tabsByWorktree[state.activeWorktreeId]?.length ?? 0)
          : 0
      })
    ).toBe(initialTabCount)

    await orcaPage.keyboard.press('Escape')
    await expect(orcaPage.getByRole('dialog', { name: 'Popup Terminal' })).toBeHidden()

    await electronApp.evaluate(({ BrowserWindow }) => {
      const webContents = BrowserWindow.getAllWindows()[0]?.webContents
      const modifier = process.platform === 'darwin' ? 'meta' : 'control'
      webContents?.sendInputEvent({
        type: 'keyDown',
        keyCode: 'Space',
        modifiers: [modifier, 'shift']
      })
      webContents?.sendInputEvent({
        type: 'keyUp',
        keyCode: 'Space',
        modifiers: [modifier, 'shift']
      })
    })
    const popup = orcaPage.getByRole('dialog', { name: 'Popup Terminal' })
    await expect(popup).toBeVisible()
    expect(
      await orcaPage.evaluate(() => {
        const state = window.__store?.getState()
        return state?.activeWorktreeId
          ? (state.tabsByWorktree[state.activeWorktreeId]?.length ?? 0)
          : 0
      })
    ).toBe(initialTabCount)

    await electronApp.evaluate(({ BrowserWindow }) => {
      const webContents = BrowserWindow.getAllWindows()[0]?.webContents
      const modifier = process.platform === 'darwin' ? 'meta' : 'control'
      webContents?.sendInputEvent({
        type: 'keyDown',
        keyCode: 'Space',
        modifiers: [modifier, 'shift']
      })
      webContents?.sendInputEvent({
        type: 'keyUp',
        keyCode: 'Space',
        modifiers: [modifier, 'shift']
      })
    })
    await expect(popup).toBeHidden()
  })
})
