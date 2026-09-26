import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'

// Only the prefix is contract: the checkpoint error appends the swallowed persist
// cause (STA-5505), whose wording belongs to whatever threw.
const CHECKPOINT_ERROR_PREFIX = 'Renderer shutdown checkpoint was not completed: '

// The null url is injected, never hydrated: the desktop session schema drops such a row, and
// no other arrival path carries browserUrlHistory at all (paired web reads it unvalidated but
// has no producer — STA-5668 follow-up). It is just a deterministic snapshot-build failure.
const CORRUPT_HISTORY_ENTRY = { url: null, title: 'corrupt persisted history', lastVisitedAt: 0 }

test('recovers update install from a corrupt clean session but preserves dirty drafts', async ({
  orcaPage,
  testRepoPath
}) => {
  const fallbackLogs: string[] = []
  orcaPage.on('console', (message) => {
    if (message.text().includes('Full renderer session snapshot failed; using durable session')) {
      fallbackLogs.push(message.text())
    }
  })
  const filePath = path.join(testRepoPath, 'checkpoint-draft.txt')
  writeFileSync(filePath, 'saved text\n')

  try {
    const fileId = await orcaPage.evaluate(
      ({ targetPath, worktreeId }) =>
        window.__store!.getState().openFile({
          filePath: targetPath,
          relativePath: 'checkpoint-draft.txt',
          worktreeId,
          language: 'plaintext',
          mode: 'edit'
        }),
      {
        targetPath: filePath,
        worktreeId: await orcaPage.evaluate(() => window.__store?.getState().activeWorktreeId ?? '')
      }
    )
    await expect
      .poll(() =>
        orcaPage.evaluate(
          (targetPath) =>
            Object.values(window.__store!.getState().workingDocuments).find(
              (document) => document.target.filePath === targetPath
            )?.loadState,
          filePath
        )
      )
      .toBe('ready')

    const dirtyResult = await orcaPage.evaluate(
      async ({ targetPath, targetFileId, corruptEntry }) => {
        const store = window.__store!
        const state = store.getState()
        const originalHistory = state.browserUrlHistory
        const document = Object.values(state.workingDocuments).find(
          (entry) => entry.target.filePath === targetPath
        )!
        state.browserUrlHistory = [corruptEntry] as unknown as typeof state.browserUrlHistory
        state.setWorkingDocumentContent(document.id, 'unsaved draft')
        try {
          await window.api.updater.quitAndInstall()
          return null
        } catch (error) {
          const current = store.getState().workingDocuments[document.id]
          return {
            message: String((error as Error)?.message ?? error),
            content: current?.content,
            isDirty: current?.isDirty
          }
        } finally {
          store.getState().discardWorkingDocument(document.id)
          store.getState().closeFile(targetFileId)
          store.getState().browserUrlHistory = originalHistory
        }
      },
      { targetPath: filePath, targetFileId: fileId, corruptEntry: CORRUPT_HISTORY_ENTRY }
    )

    expect(dirtyResult).toMatchObject({ content: 'unsaved draft', isDirty: true })
    expect(dirtyResult?.message).toContain(CHECKPOINT_ERROR_PREFIX)
    // Pin the cause to the corrupt row, not just any named failure; only the member name
    // survives V8 rewording of "Cannot read properties of null".
    expect(dirtyResult?.message).toContain('toLowerCase')
  } finally {
    rmSync(filePath, { force: true })
  }

  const cleanResult = await orcaPage.evaluate(async (corruptEntry) => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    const state = store.getState()
    const originalHistory = state.browserUrlHistory
    state.browserUrlHistory = [corruptEntry] as unknown as typeof state.browserUrlHistory
    try {
      await window.api.updater.quitAndInstall()
      return 'continued'
    } catch (error) {
      return String((error as Error)?.message ?? error)
    } finally {
      state.browserUrlHistory = originalHistory
    }
  }, CORRUPT_HISTORY_ENTRY)

  expect(cleanResult).toBe('continued')
  expect(fallbackLogs).toHaveLength(1)
})
