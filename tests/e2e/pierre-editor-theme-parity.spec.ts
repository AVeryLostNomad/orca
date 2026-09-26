import { expect, test } from './helpers/orca-app'
import {
  cleanupGoldenWorktree,
  createGoldenWorktree,
  GOLDEN_CHANGED_PATH,
  openGoldenSourceControl,
  seedGoldenSourceEdit
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'

test('@golden applies the selected Monaco theme to native Pierre syntax and background', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const fixture = createGoldenWorktree(testRepoPath, 'pierre-editor-theme-parity')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  seedGoldenSourceEdit(fixture.worktreePath)

  await waitForSessionReady(orcaPage)
  await openGoldenSourceControl(orcaPage, testRepoPath, fixture)
  await orcaPage
    .locator(
      `[data-testid="source-control-entry"][data-source-control-path="${GOLDEN_CHANGED_PATH}"]`
    )
    .click()

  const diff = orcaPage.getByTestId('pierre-file-diff')
  await expect(diff).toBeVisible({ timeout: 20_000 })
  await expect(diff.locator('.pierre-monaco-editor-overlay .monaco-editor')).toBeVisible({
    timeout: 20_000
  })
  await orcaPage.evaluate(async () => {
    await window.__store!.getState().updateSettings({
      theme: 'dark',
      editorThemeDark: 'dracula'
    })
  })

  await expect
    .poll(() =>
      diff.evaluate((element) => {
        const host = element.querySelector<HTMLElement>('diffs-container')
        const shadowRoot = host?.shadowRoot
        const modifiedEditor = element.querySelector<HTMLElement>(
          '.pierre-monaco-editor-overlay .monaco-editor'
        )
        if (!host || !shadowRoot || !modifiedEditor) {
          return null
        }

        const text = (token: Element): string => (token.textContent ?? '').replaceAll('\u00a0', ' ')
        const nativeTokens = Array.from(
          shadowRoot.querySelectorAll<HTMLElement>('[data-line-type="change-deletion"] span')
        ).filter((token) => token.children.length === 0)
        const nativeKeyword = nativeTokens.find((token) => /\bexport\b/.test(text(token)))
        const nativeString = nativeTokens.find((token) => text(token).includes('world'))
        const modifiedLine = Array.from(
          modifiedEditor.querySelectorAll<HTMLElement>('.view-line')
        ).find((line) => text(line).includes('golden daily loop'))
        const modifiedTokens = Array.from(
          modifiedLine?.querySelectorAll<HTMLElement>('span') ?? []
        ).filter((token) => token.children.length === 0)
        const modifiedKeyword = modifiedTokens.find((token) => /\bexport\b/.test(text(token)))
        const modifiedString = modifiedTokens.find((token) =>
          text(token).includes('golden daily loop')
        )
        if (!nativeKeyword || !nativeString || !modifiedKeyword || !modifiedString) {
          return null
        }

        // The native diff lives in a shadow root, so resolve its actual surface
        // through a probe rather than comparing an unresolved CSS variable.
        const backgroundProbe = document.createElement('div')
        backgroundProbe.style.backgroundColor = 'var(--diffs-dark-bg)'
        shadowRoot.append(backgroundProbe)
        const nativeBackground = getComputedStyle(backgroundProbe).backgroundColor
        backgroundProbe.style.backgroundColor = 'var(--vscode-editor-background)'
        modifiedEditor.append(backgroundProbe)
        const modifiedBackground = getComputedStyle(backgroundProbe).backgroundColor
        backgroundProbe.remove()

        return {
          nativeBackground,
          modifiedBackground,
          nativeKeyword: getComputedStyle(nativeKeyword).color,
          modifiedKeyword: getComputedStyle(modifiedKeyword).color,
          nativeString: getComputedStyle(nativeString).color,
          modifiedString: getComputedStyle(modifiedString).color
        }
      })
    )
    .toEqual({
      nativeBackground: 'rgb(40, 42, 54)',
      modifiedBackground: 'rgb(40, 42, 54)',
      nativeKeyword: 'rgb(255, 121, 198)',
      modifiedKeyword: 'rgb(255, 121, 198)',
      nativeString: 'rgb(241, 250, 140)',
      modifiedString: 'rgb(241, 250, 140)'
    })
  await diff.screenshot({ path: testInfo.outputPath('pierre-selected-theme.png') })
})
