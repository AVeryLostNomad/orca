import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Locator, Page } from '@stablyai/playwright-test'
import type { PublishDiagnosticsParams } from 'vscode-languageserver-protocol'
import { runProcess } from '../../../src/shared/child-process/run-process'
import { expect } from './orca-app'

const SUPPORT = 'live-lsp-support.ts'
const FILES = ['live-lsp-ordinary.ts', 'live-lsp-explicit.ts', 'live-lsp-combined.ts']
const INITIAL =
  "import { buildLiveWidget } from './live-lsp-support'\nconst result = buildLiveWidget('baseline')\nexport const total: number = result.answerFromSibling\n"
const INVALID =
  "import { buildLiveWidget } from './live-lsp-support'\nconst result = buildLiveWidget('changed')\nexport const total: number = result.label\n"
const COMPACT =
  "import{buildLiveWidget}from'./live-lsp-support'\nconst result=buildLiveWidget('changed')\nexport const total:number=result.answerFromSibling\n"

declare global {
  // oxlint-disable-next-line typescript-eslint/consistent-type-definitions -- declaration merging requires interface
  interface Window {
    __liveDiffLspDiagnostics?: PublishDiagnosticsParams[]
    __stopLiveDiffLspProbe?: () => void
  }
}

export async function seedLiveDiffLspFixtures(worktreePath: string): Promise<void> {
  writeFileSync(
    path.join(worktreePath, SUPPORT),
    'export function buildLiveWidget(label: string): { label: string; answerFromSibling: number } {\n  return { label, answerFromSibling: 42 }\n}\n' +
      'export function buildLiveAction(): number { return 7 }\n'
  )
  writeFileSync(
    path.join(worktreePath, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'node'
      },
      include: ['live-lsp-*.ts']
    })
  )
  for (const file of FILES) {
    writeFileSync(path.join(worktreePath, file), INITIAL)
  }
  for (const args of [
    ['add', '--', SUPPORT, 'tsconfig.json', ...FILES],
    ['commit', '-m', 'Seed real TypeScript language-server fixtures']
  ]) {
    const result = await runProcess({ program: 'git', args, cwd: worktreePath })
    expect(result.code, result.stderr).toBe(0)
  }
  for (const file of FILES) {
    writeFileSync(path.join(worktreePath, file), INVALID)
  }
}

async function selectSymbol(page: Page, editor: Locator, symbol: string): Promise<void> {
  await editor.locator('.view-line').first().click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home')
  await page.keyboard.press('ControlOrMeta+F')
  const input = page.getByRole('textbox', { name: 'Find', exact: true })
  await expect(input).toBeVisible()
  await input.fill(symbol)
  await page.keyboard.press('Escape')
}

async function runEditorCommand(page: Page, command: string): Promise<void> {
  await page.keyboard.press('F1')
  const input = page.locator('.quick-input-widget input').filter({ visible: true }).first()
  await expect(input).toBeVisible()
  await input.fill(`>${command}`)
  await page.keyboard.press('Enter')
}

async function documentContent(page: Page, filePath: string): Promise<string | undefined> {
  return page.evaluate(
    (target) =>
      Object.values(window.__store!.getState().workingDocuments).find(
        (document) => document.target.filePath === target
      )?.content,
    filePath
  )
}

export async function exerciseLiveDiffLsp(
  page: Page,
  worktreePath: string,
  screenshotPath: (name: string) => string
): Promise<void> {
  await page.evaluate(async () => {
    window.__liveDiffLspDiagnostics = []
    window.__stopLiveDiffLspProbe = window.api.lsp.onEvent(({ event }) => {
      if (event.kind === 'notification' && event.method === 'textDocument/publishDiagnostics') {
        window.__liveDiffLspDiagnostics!.push(event.params as PublishDiagnosticsParams)
      }
    })
    await window.__store!.getState().updateSettings({
      lspEnabled: true,
      lspDisabledServers: [],
      editorAutoSave: false,
      combinedDiffFileTreeVisibleByDefault: true
    })
  })
  try {
    for (const [index, relativePath] of FILES.entries()) {
      const filePath = path.join(worktreePath, relativePath)
      const uri = pathToFileURL(filePath).toString()
      const openSurface = async (): Promise<Locator> => {
        if (index === 1) {
          await page
            .locator(
              `[data-testid="source-control-entry"][data-source-control-path="${relativePath}"]`
            )
            .click()
          const editor = page.getByTestId('pierre-file-diff').locator('.monaco-editor')
          await expect(editor).toBeVisible()
          return editor
        } else if (index === 2) {
          await page.evaluate((root) => {
            const state = window.__store!.getState()
            state.openAllDiffs(state.activeWorktreeId!, root, undefined, 'unstaged')
          }, worktreePath)
          await page.locator(`[data-combined-diff-tree-path="${relativePath}"]`).click()
          const editor = page
            .locator('[data-combined-diff-section-row]')
            .filter({ hasText: relativePath })
            .locator('.monaco-editor')
          await expect(editor).toBeVisible()
          return editor
        }
        await page.evaluate(
          ({ filePath, relativePath }) => {
            const state = window.__store!.getState()
            state.openFile(
              {
                filePath,
                relativePath,
                worktreeId: state.activeWorktreeId!,
                language: 'typescript',
                mode: 'edit'
              },
              { preview: false, focusEditor: true }
            )
          },
          { filePath, relativePath }
        )
        return page.locator('.monaco-editor').first()
      }
      let editor = await openSurface()
      await expect(editor).toContainText('result.label', { timeout: 30_000 })
      await expect
        .poll(
          () =>
            page.evaluate(
              (uri) =>
                window.__liveDiffLspDiagnostics
                  ?.findLast((event) => event.uri === uri)
                  ?.diagnostics.some((diagnostic) => diagnostic.code === 2322),
              uri
            ),
          { timeout: 90_000, message: `Real TypeScript diagnostics for ${relativePath}` }
        )
        .toBe(true)
      await expect(editor.locator('.squiggly-error').first()).toBeVisible()

      await selectSymbol(page, editor, 'buildLiveWidget')
      await runEditorCommand(page, 'Show or Focus Hover')
      await expect(page.locator('.monaco-hover').filter({ visible: true }).first()).toContainText(
        'answerFromSibling',
        { timeout: 15_000 }
      )
      await page.keyboard.press('Escape')
      if (index === 0) {
        await page.keyboard.press('Escape')
        await page.keyboard.press('Shift+F12')
        const peek = page.locator('.reference-zone-widget').filter({ visible: true })
        const tree = peek.locator('.ref-tree')
        // The open file previews through its working model; unopened files through disk snapshots.
        await expect(tree).toContainText('result = buildLiveWidget', { timeout: 15_000 })
        await expect(tree).not.toContainText(/\.ts:\d+:\d+/)
        await expect(peek.locator('.preview .view-lines')).toContainText('buildLiveWidget')
        await tree.getByText(SUPPORT, { exact: true }).click()
        const supportReference = tree.getByText(/function buildLiveWidget\(label: string\)/)
        await expect(supportReference).toBeVisible()
        await supportReference.click()
        await expect(peek.locator('.preview .view-lines')).toContainText('answerFromSibling: 42')
        await page.keyboard.press('Escape')
        await expect(peek).toHaveCount(0)
      }
      await page.keyboard.press('F12')
      await expect(page.locator('.editor-header-path').first()).toHaveAttribute(
        'title',
        path.join(worktreePath, SUPPORT).replaceAll('\\', '/')
      )
      await expect(page.locator('.monaco-editor').first()).toContainText('answerFromSibling: 42')
      editor = await openSurface()

      await editor.locator('.view-line').first().click()
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
      await page.keyboard.insertText('\nresult.ans')
      await page.keyboard.press('Control+Space')
      await expect(
        page
          .locator('.suggest-widget')
          .filter({ visible: true })
          .getByText('answerFromSibling', { exact: true })
      ).toBeVisible({ timeout: 15_000 })
      await page.keyboard.press('Enter')
      await expect.poll(() => documentContent(page, filePath)).toContain('result.answerFromSibling')
      await page.keyboard.insertText('\nconst labelProbe = buildLiveWidget(')
      await runEditorCommand(page, 'Trigger Parameter Hints')
      await expect(page.locator('.parameter-hints-widget').filter({ visible: true })).toContainText(
        'label: string',
        { timeout: 15_000 }
      )
      await page.keyboard.press('Escape')

      await editor.locator('.view-line').first().click()
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.insertText(COMPACT)
      await page.keyboard.press('ControlOrMeta+S')
      await expect.poll(() => readFileSync(filePath, 'utf8')).toBe(COMPACT)
      await expect
        .poll(
          () =>
            page.evaluate(
              (uri) =>
                window.__liveDiffLspDiagnostics?.findLast((event) => event.uri === uri)
                  ?.diagnostics,
              uri
            ),
          {
            timeout: 20_000,
            message: `Saved correction clears real server diagnostics for ${relativePath}`
          }
        )
        .toEqual([])
      await expect(editor.locator('.squiggly-error')).toHaveCount(0)

      await runEditorCommand(page, 'Format Document')
      await expect
        .poll(() => documentContent(page, filePath))
        .toContain('const result = buildLiveWidget')
      await selectSymbol(page, editor, 'result')
      await page.keyboard.press('F2')
      const rename = page.locator('.rename-box input').filter({ visible: true })
      await expect(rename).toBeVisible({ timeout: 15_000 })
      await rename.fill('widgetResult')
      await page.keyboard.press('Enter')
      await expect.poll(() => documentContent(page, filePath)).toMatch(/const widgetResult\s*=/)
      await expect
        .poll(() => documentContent(page, filePath))
        .toContain('widgetResult.answerFromSibling')
      await page.keyboard.press('ControlOrMeta+S')
      await expect
        .poll(() => readFileSync(filePath, 'utf8'))
        .toContain('widgetResult.answerFromSibling')
      await expect(page.getByText(/Installing TypeScript|Starting TypeScript/)).toHaveCount(0)
      await editor.locator('.view-line').first().click()
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
      await page.keyboard.insertText('\nexport const actionResult = buildLiveAction()\n')
      await expect
        .poll(() =>
          page.evaluate(
            (uri) =>
              window.__liveDiffLspDiagnostics
                ?.findLast((event) => event.uri === uri)
                ?.diagnostics.some((diagnostic) => diagnostic.code === 2304),
            uri
          )
        )
        .toBe(true)
      await selectSymbol(page, editor, 'buildLiveAction')
      await runEditorCommand(page, 'Quick Fix')
      const importAction = page
        .locator('.action-widget')
        .filter({ visible: true })
        .getByRole('option', { name: /import from/ })
        .first()
      await expect(importAction).toBeVisible({ timeout: 15_000 })
      const actionBox = await importAction.boundingBox()
      if (!actionBox) {
        throw new Error('Import quick fix has no rendered bounds')
      }
      // Monaco dismisses its opening-click guard on actual pointer movement.
      await page.mouse.move(actionBox.x + actionBox.width / 2, actionBox.y + actionBox.height / 2)
      await importAction.click()
      await expect
        .poll(() => documentContent(page, filePath))
        .toMatch(/import\s*\{[^}]*buildLiveAction/)
      await editor.screenshot({
        path: screenshotPath(
          `real-lsp-${index === 0 ? 'ordinary' : index === 1 ? 'explicit' : 'combined'}.png`
        )
      })
    }
  } finally {
    await page.evaluate(() => {
      window.__stopLiveDiffLspProbe?.()
      delete window.__stopLiveDiffLspProbe
      delete window.__liveDiffLspDiagnostics
    })
  }
}
