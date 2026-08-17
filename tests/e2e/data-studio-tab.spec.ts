/**
 * Data Studio tab: creating the tab spins up the per-repo Azure Data Studio
 * web-server instance (stable port, per-repo webview partition), the pane
 * reaches 'ready', and closing the last tab stops the repo's server.
 *
 * Why a fake ADS server root: the real one is a ~5GB from-source build
 * (resources/data-studio/install-ads-server.sh). ORCA_ADS_SERVER_ROOT points
 * at a stub whose out/server-main.js serves 200 on the assigned port — which
 * still exercises the full path: root/entry/node-runtime resolution, stable
 * port allocation, spawn args, readiness probing on '/', status broadcast,
 * and the webview pointed at the per-repo origin.
 */
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { getStoreState, waitForSessionReady, getActiveWorktreeId } from './helpers/store'
import type { DataStudioStatusEvent } from '../../src/shared/data-studio-types'

const fakeAdsRoot = mkdtempSync(path.join(os.tmpdir(), 'orca-fake-ads-'))
mkdirSync(path.join(fakeAdsRoot, 'out'), { recursive: true })
writeFileSync(
  path.join(fakeAdsRoot, 'out', 'server-main.js'),
  `const http = require('http')
const port = Number(process.argv[process.argv.indexOf('--port') + 1])
http.createServer((req, res) => { res.statusCode = 200; res.end('ok') }).listen(port, '127.0.0.1')
`
)
const fakeNodeDir = path.join(fakeAdsRoot, '.build', 'node', 'v0.0.0-test', 'test-platform')
mkdirSync(fakeNodeDir, { recursive: true })
symlinkSync(process.execPath, path.join(fakeNodeDir, 'node'))
chmodSync(path.join(fakeNodeDir, 'node'), 0o755)

test.use({ orcaAppExtraEnv: { ORCA_ADS_SERVER_ROOT: fakeAdsRoot } })

test.describe('Data Studio tab', () => {
  // Data Studio ships on Windows too, but this spec's fake server root uses a
  // symlinked node runtime, which needs privileges to create on Windows CI.
  test.skip(process.platform === 'win32', 'fake ADS root uses symlinks')

  test('creates the per-repo server, reaches ready, and stops on close', async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await expect.poll(async () => getActiveWorktreeId(orcaPage), { timeout: 20_000 }).not.toBeNull()
    const worktreeId = (await getActiveWorktreeId(orcaPage))!

    const created = await orcaPage.evaluate((targetWorktreeId) => {
      const state = window.__store!.getState()
      const worktree = state.getKnownWorktreeById(targetWorktreeId)
      if (!worktree) {
        return null
      }
      const tab = state.createDataStudioTab(
        targetWorktreeId,
        worktree.repoId,
        worktree.path,
        'Data Studio'
      )
      return { tabId: tab.id, repoId: tab.repoId }
    }, worktreeId)
    expect(created).not.toBeNull()
    const { tabId, repoId } = created!

    // The chip renders in the tab strip and the overlay slot becomes active.
    await expect(orcaPage.locator(`[data-data-studio-overlay-tab-id="${tabId}"]`)).toBeVisible({
      timeout: 10_000
    })

    // The per-repo server (fake root) reaches ready — entry/runtime resolution,
    // stable-port allocation, spawn, and readiness probing all succeeded.
    await expect
      .poll(
        async () =>
          (
            await getStoreState<Record<string, DataStudioStatusEvent>>(
              orcaPage,
              'dataStudioStatusByRepo'
            )
          )[repoId]?.status,
        { timeout: 30_000, message: 'per-repo Data Studio server never reached ready' }
      )
      .toBe('ready')

    const ipcStatus = await orcaPage.evaluate(
      (targetRepoId) => window.api.dataStudio.getStatus({ repoId: targetRepoId }),
      repoId
    )
    expect(ipcStatus?.status).toBe('ready')
    // Stable per-repo port range (the workbench's client storage is origin-keyed).
    expect(ipcStatus?.port).toBeGreaterThanOrEqual(41100)
    expect(ipcStatus?.port).toBeLessThanOrEqual(41999)

    // The webview is bucketed into the repo's own partition — never the shared
    // editor partition — so saved DB passwords can't cross projects.
    await expect
      .poll(
        async () =>
          orcaPage.evaluate(
            (targetTabId) =>
              document
                .querySelector(`[data-data-studio-overlay-tab-id="${targetTabId}"] webview`)
                ?.getAttribute('partition') ?? null,
            tabId
          ),
        { timeout: 15_000, message: 'Data Studio webview never attached' }
      )
      .toMatch(/^persist:orca-datastudio-[0-9a-f]{16}$/)

    // Closing the last Data Studio tab of the repo stops its server.
    await orcaPage.evaluate((targetTabId) => {
      window.__store!.getState().closeDataStudioTab(targetTabId)
    }, tabId)
    await expect
      .poll(
        async () =>
          (
            await orcaPage.evaluate(
              (targetRepoId) => window.api.dataStudio.getStatus({ repoId: targetRepoId }),
              repoId
            )
          )?.status,
        { timeout: 15_000, message: 'server did not stop after the last tab closed' }
      )
      .toBe('stopped')
  })
})
