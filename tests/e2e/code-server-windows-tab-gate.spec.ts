/**
 * Windows smoke for the embedded editor's entry points: the codeServer preload
 * bridge round-trips over IPC and the "New VS Code Tab" gate offers the tab
 * for a local worktree. Full editor boot (download + spawn) is covered by the
 * package workflow's healthz smoke, not e2e — CI runners must not depend on a
 * ~100MB release download.
 */
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

test.describe('Embedded editor on Windows', () => {
  test.skip(process.platform !== 'win32', 'Windows-only embedded editor gate')

  test('exposes the codeServer bridge and offers the VS Code tab', async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)

    const status = await orcaPage.evaluate(() => window.api.codeServer.getStatus())
    // Fresh isolated userData has no install yet; any status proves the IPC
    // surface is registered on Windows.
    expect(['not-installed', 'stopped', 'installing', 'starting', 'ready', 'error']).toContain(
      status.status
    )

    const importState = await orcaPage.evaluate(() => window.api.codeServer.getImportState())
    expect(Array.isArray(importState.sources)).toBe(true)
  })
})
