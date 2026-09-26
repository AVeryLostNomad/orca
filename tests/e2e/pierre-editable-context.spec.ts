import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import {
  cleanupGoldenWorktree,
  createGoldenWorktree,
  openGoldenSourceControl
} from './helpers/golden-source-control'
import {
  PIERRE_CONTEXT_FIXTURE,
  seedLiveDiffWhitespaceFixtures
} from './helpers/editor-live-diff-fixtures'
import { readWorkingDocument } from './helpers/editor-live-diff-lifetime'
import { waitForSessionReady } from './helpers/store'

test('@golden edits expanded Pierre context and shares undo with the ordinary editor', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const fixture = createGoldenWorktree(testRepoPath, 'pierre-editable-context')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  await seedLiveDiffWhitespaceFixtures(fixture.worktreePath)
  const filePath = realpathSync(path.join(fixture.worktreePath, PIERRE_CONTEXT_FIXTURE.name))
  await waitForSessionReady(orcaPage)
  await openGoldenSourceControl(orcaPage, testRepoPath, fixture)
  await orcaPage.evaluate(() =>
    window.__store!.getState().updateSettings({
      editorAutoSave: false,
      diffShowWhitespace: false,
      diffDefaultView: 'side-by-side'
    })
  )
  const row = orcaPage.locator(
    `[data-testid="source-control-entry"][data-source-control-path="${PIERRE_CONTEXT_FIXTURE.name}"]`
  )
  await row.click()
  const diff = orcaPage.getByTestId('pierre-file-diff')
  const editable = diff.locator('.monaco-editor')
  await expect(editable).toBeVisible({ timeout: 20_000 })
  const firstLine = editable.locator('.view-line').filter({ hasText: 'export const n0 = 0' })
  await expect(firstLine).toHaveCount(0)
  await expect(diff.getByText(/\d+ unmodified lines/).first()).toBeVisible()
  await diff.locator('[data-expand-button]').first().click()
  await expect(firstLine).toBeVisible()
  await firstLine.click()
  await orcaPage.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home')
  await orcaPage.keyboard.press(
    process.platform === 'darwin' ? 'Meta+Shift+ArrowRight' : 'Shift+End'
  )
  await orcaPage.keyboard.insertText('    export const n0 = 7  ')
  const firstEdit = PIERRE_CONTEXT_FIXTURE.modified.replace('n0 = 0', 'n0 = 7')
  await expect
    .poll(async () => (await readWorkingDocument(orcaPage, filePath))?.content)
    .toBe(firstEdit)
  expect(readFileSync(filePath, 'utf8')).toBe(PIERRE_CONTEXT_FIXTURE.modified)
  await expect(diff.locator('[data-content] [data-line-type$="addition"]')).toHaveCount(2)
  await orcaPage.keyboard.insertText(' // retained caret')
  const edited = firstEdit.replace('n0 = 7  ', 'n0 = 7   // retained caret')
  await expect
    .poll(async () => (await readWorkingDocument(orcaPage, filePath))?.content)
    .toBe(edited)
  await expect
    .poll(async () => {
      const native = await diff
        .locator('[data-additions] [data-content] [data-line="16"]')
        .boundingBox()
      const projected = await editable
        .locator('.view-line')
        .filter({ hasText: 'export const n15 = 99' })
        .boundingBox()
      return native && projected ? Math.abs(native.y - projected.y) : Number.POSITIVE_INFINITY
    })
    .toBeLessThan(1)
  await diff.screenshot({ path: testInfo.outputPath('pierre-editable-expanded-context.png') })

  await row.dblclick()
  const ordinary = orcaPage.locator('.monaco-editor').first()
  await expect(ordinary).toContainText('export const n0 = 7')
  await ordinary.click()
  let undoCount = 0
  while (
    undoCount < 20 &&
    (await readWorkingDocument(orcaPage, filePath))?.content !== PIERRE_CONTEXT_FIXTURE.modified
  ) {
    await orcaPage.keyboard.press('ControlOrMeta+Z')
    undoCount++
  }
  await expect
    .poll(async () => (await readWorkingDocument(orcaPage, filePath))?.content)
    .toBe(PIERRE_CONTEXT_FIXTURE.modified)
  await row.click()
  await expect(editable).toBeVisible()
  await editable.click()
  for (let index = 0; index < undoCount; index++) {
    await orcaPage.keyboard.press('ControlOrMeta+Shift+Z')
  }
  await expect
    .poll(async () => (await readWorkingDocument(orcaPage, filePath))?.content)
    .toBe(edited)
  await expect(diff.locator('[data-content] [data-line-type$="addition"]')).toHaveCount(2)
  await orcaPage.keyboard.press('ControlOrMeta+S')
  await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(edited)
  await expect
    .poll(async () => (await readWorkingDocument(orcaPage, filePath))?.isDirty)
    .toBe(false)

  await orcaPage.evaluate(() =>
    window.__store!.getState().updateSettings({
      diffDefaultView: 'inline',
      editorAutoSave: true
    })
  )
  await expect(diff.locator('[data-diff-type="single"]')).toBeVisible()
  await editable.click()
  await orcaPage.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
  await orcaPage.keyboard.insertText('// autosaved in unified diff\n')
  await expect
    .poll(() => readFileSync(filePath, 'utf8'), { timeout: 15_000 })
    .toBe(`${edited}// autosaved in unified diff\n`)
  await orcaPage.evaluate(() => window.__store!.getState().updateSettings({ diffWordWrap: true }))
  await editable.click()
  await orcaPage.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
  const wrapped = `export const wrapProbe = "${'wrap '.repeat(80)}"\nexport const afterWrap = 1\n`
  await orcaPage.keyboard.insertText(wrapped)
  await expect
    .poll(() => readFileSync(filePath, 'utf8'), { timeout: 15_000 })
    .toBe(`${edited}// autosaved in unified diff\n${wrapped}`)
  await expect
    .poll(async () => {
      const native = await diff
        .locator('[data-content] > [data-line]')
        .filter({ hasText: 'export const afterWrap = 1' })
        .boundingBox()
      const projected = await editable
        .locator('.view-line')
        .filter({ hasText: 'export const afterWrap = 1' })
        .boundingBox()
      return native && projected ? Math.abs(native.y - projected.y) : Number.POSITIVE_INFINITY
    })
    .toBeLessThan(1)
})

test('@golden keeps replacement rows aligned while hovering Pierre diffs', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const fixture = createGoldenWorktree(testRepoPath, 'pierre-hover-alignment')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  await seedLiveDiffWhitespaceFixtures(fixture.worktreePath)
  await waitForSessionReady(orcaPage)
  await openGoldenSourceControl(orcaPage, testRepoPath, fixture)
  await orcaPage.evaluate(() =>
    window.__store!.getState().updateSettings({ diffShowWhitespace: false })
  )
  await orcaPage
    .locator(
      `[data-testid="source-control-entry"][data-source-control-path="${PIERRE_CONTEXT_FIXTURE.name}"]`
    )
    .click()
  const diff = orcaPage.getByTestId('pierre-file-diff')
  for (const layout of ['inline', 'side-by-side'] as const) {
    await orcaPage.evaluate(
      (diffDefaultView) => window.__store!.getState().updateSettings({ diffDefaultView }),
      layout
    )
    await expect(
      diff.locator(
        layout === 'inline' ? '[data-code][data-unified]' : '[data-code][data-additions]'
      )
    ).toBeVisible()
    const projected = diff
      .locator('.monaco-editor .view-line')
      .filter({ hasText: 'export const n15 = 99' })
    await expect(projected).toBeVisible()
    const deletion = diff.locator('[data-code] [data-line-type="change-deletion"]').first()
    await expect(deletion).toBeVisible()
    await diff.evaluate((element) => {
      const host = element.querySelector('diffs-container')!
      const root = host.shadowRoot!
      const deletionSelector = '[data-code] [data-line-type="change-deletion"]'
      const deletionTop = root.querySelector(deletionSelector)!.getBoundingClientRect().top
      const sample = (): number => {
        const native = root.querySelector(
          '[data-additions] [data-content] > [data-line="16"], [data-unified] [data-content] > [data-line="16"]:not([data-line-type="change-deletion"])'
        )
        const overlay = [...element.querySelectorAll('.monaco-editor .view-line')].find((line) =>
          line.textContent?.replaceAll('\u00a0', ' ').includes('export const n15 = 99')
        )
        const baseline = root.querySelector(deletionSelector)
        return native && overlay && baseline
          ? Math.max(
              Math.abs(native.getBoundingClientRect().top - overlay.getBoundingClientRect().top),
              Math.abs(baseline.getBoundingClientRect().top - deletionTop)
            )
          : Number.POSITIVE_INFINITY
      }
      const state = { errors: [] as number[], frame: 0 }
      const tick = (): void => {
        state.errors.push(sample())
        state.frame = requestAnimationFrame(tick)
      }
      tick()
      ;(element as HTMLElement & { stopSampling?: () => number[] }).stopSampling = () => {
        cancelAnimationFrame(state.frame)
        return state.errors
      }
    })
    for (let index = 0; index < 12; index++) {
      await (index % 2 ? projected : deletion).hover()
      await orcaPage.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      )
    }
    const errors = await diff.evaluate((element) => {
      const probe = element as HTMLElement & { stopSampling?: () => number[] }
      const samples = probe.stopSampling!()
      delete probe.stopSampling
      return samples
    })
    expect(Math.max(...errors)).toBeLessThan(1)
    await diff.screenshot({ path: testInfo.outputPath(`pierre-hover-${layout}.png`) })
  }
})

test('@golden scrolls long Pierre code rows without scrolling the diff frame', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const fixture = createGoldenWorktree(testRepoPath, 'pierre-horizontal-scroll')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  await seedLiveDiffWhitespaceFixtures(fixture.worktreePath)
  writeFileSync(
    path.join(fixture.worktreePath, PIERRE_CONTEXT_FIXTURE.name),
    PIERRE_CONTEXT_FIXTURE.modified.replace('n15 = 99', `n15 = 99 // ${'wide '.repeat(120)}`)
  )
  await waitForSessionReady(orcaPage)
  await openGoldenSourceControl(orcaPage, testRepoPath, fixture)
  await orcaPage.evaluate(() =>
    window.__store!.getState().updateSettings({ diffShowWhitespace: false })
  )
  await orcaPage
    .locator(
      `[data-testid="source-control-entry"][data-source-control-path="${PIERRE_CONTEXT_FIXTURE.name}"]`
    )
    .click()
  const diff = orcaPage.getByTestId('pierre-file-diff')
  for (const layout of ['inline', 'side-by-side'] as const) {
    await orcaPage.evaluate(
      (diffDefaultView) => window.__store!.getState().updateSettings({ diffDefaultView }),
      layout
    )
    const projected = diff
      .locator('.monaco-editor .view-line')
      .filter({ hasText: 'export const n15 = 99' })
    await expect(projected).toBeVisible()
    await projected.hover()
    await orcaPage.mouse.wheel(400, 0)
    const measure = (): Promise<{ code: number; frame: number; drift: number }> =>
      diff.evaluate((element) => {
        const root = element.querySelector('diffs-container')!.shadowRoot!
        const native = root.querySelector<HTMLElement>(
          '[data-additions] [data-content] > [data-line="16"], [data-unified] [data-content] > [data-line="16"]:not([data-line-type="change-deletion"])'
        )!
        const overlay = [...element.querySelectorAll('.monaco-editor .view-line')].find((line) =>
          line.textContent?.includes('n15')
        )!
        let frame = 0
        for (let node: HTMLElement | null = element; node; node = node.parentElement) {
          frame = Math.max(frame, node.scrollLeft)
        }
        const nativeTextLeft =
          native.getBoundingClientRect().left +
          Number.parseFloat(getComputedStyle(native).paddingLeft)
        return {
          code: native.closest<HTMLElement>('[data-code]')!.scrollLeft,
          frame,
          drift: Math.abs(overlay.getBoundingClientRect().left - nativeTextLeft)
        }
      })
    await expect.poll(async () => (await measure()).code).toBeGreaterThan(0)
    await expect.poll(async () => (await measure()).drift).toBeLessThan(1)
    expect((await measure()).frame).toBe(0)
    await diff.screenshot({ path: testInfo.outputPath(`pierre-horizontal-${layout}.png`) })
    await orcaPage.mouse.wheel(-10_000, 0)
  }
})
