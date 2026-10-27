import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { createEditorStore } from './editor-autosave-controller-test-fixture'
import { createEditorSaveQueue, type DocumentSaveTrigger } from './editor-save-queue'
import {
  GUARDED_PATH,
  guardedDocument,
  openGuardedFile,
  stubGuardedDisk
} from './editor-save-guarded-disk-fixture'
import { isAutosaveSuspendedForWorkingDocument } from './editor-autosave'
import { __clearNonUtf8AutosavePausesForTests } from './editor-non-utf8-autosave-pause'

vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }))

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.mocked(toast.warning).mockClear()
  __clearNonUtf8AutosavePausesForTests()
})

it.each([
  ['autosave', 'refused'],
  ['user', 'not-utf8'],
  ['convert', 'written'],
  ['overwrite', 'written']
] as const)('a lossy baseline needs consent to write (%s: %s)', async (trigger, expected) => {
  const decoded = Buffer.from([0x61, 0xfe]).toString('utf8')
  const newer = Buffer.from([0x61, 0xff]).toString('utf8')
  const disk = stubGuardedDisk({ [GUARDED_PATH]: newer })
  const store = createEditorStore()
  // The loaded text is itself lossy; the edit keeps those undecodable characters.
  openGuardedFile(store, { baseline: decoded, draft: `${decoded}!` })
  const queue = createEditorSaveQueue(store)
  try {
    const save = queue.queueSave(
      guardedDocument(store, GUARDED_PATH).id,
      trigger as DocumentSaveTrigger
    )
    await (expected === 'not-utf8' ? expect(save).rejects.toThrow(/isn't UTF-8/) : save)
    const document = guardedDocument(store, GUARDED_PATH)
    expect(document.isDirty).toBe(expected !== 'written')
    // Why: a non-UTF-8 refusal is not a changed-on-disk conflict.
    expect(document.externalMutation).toBeUndefined()
    // Why: an explicit save asks to convert instead of pausing autosave with a notice.
    const automatic = trigger === 'autosave'
    expect(isAutosaveSuspendedForWorkingDocument(document)).toBe(automatic)
    expect(toast.warning).toHaveBeenCalledTimes(automatic ? 1 : 0)
    expect(disk.files.get(GUARDED_PATH)).toBe(expected === 'written' ? `${decoded}!` : newer)
  } finally {
    queue.dispose()
  }
})

it('pauses autosave once for a non-UTF-8 file until a confirmed explicit save converts it', async () => {
  const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9]).toString('utf8')
  const disk = stubGuardedDisk({ [GUARDED_PATH]: latin1 })
  const store = createEditorStore()
  openGuardedFile(store, { baseline: latin1, draft: `${latin1}!` })
  const queue = createEditorSaveQueue(store)
  const id = guardedDocument(store, GUARDED_PATH).id
  try {
    await queue.queueSave(id, 'autosave')
    await queue.queueSave(id, 'autosave')
    expect(disk.writeFile).toHaveBeenCalledTimes(1)
    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.warning).mock.calls[0]?.[0]).toContain("isn't UTF-8 text")

    await expect(queue.queueSave(id, 'user')).rejects.toThrow(/isn't UTF-8/)
    expect(disk.files.get(GUARDED_PATH)).toBe(latin1)
    await queue.queueSave(id, 'convert')
    expect(disk.files.get(GUARDED_PATH)).toBe(`${latin1}!`)
    expect(isAutosaveSuspendedForWorkingDocument(guardedDocument(store, GUARDED_PATH))).toBe(false)
  } finally {
    queue.dispose()
  }
})

it.each(['close', 'reload'] as const)(
  'lifts the pause on %s, so the next edit is asked about again',
  async (ending) => {
    const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9]).toString('utf8')
    const disk = stubGuardedDisk({ [GUARDED_PATH]: latin1 })
    const store = createEditorStore()
    openGuardedFile(store, { baseline: latin1, draft: `${latin1}!` })
    const queue = createEditorSaveQueue(store)
    try {
      await queue.queueSave(guardedDocument(store, GUARDED_PATH).id, 'autosave')
      const document = guardedDocument(store, GUARDED_PATH)
      if (ending === 'close') {
        store.getState().discardWorkingDocument(document.id)
        store.setState({ openFiles: [] })
      } else {
        store
          .getState()
          .discardWorkingDocumentEdits(document.id, latin1, document.lastKnownDiskSignature)
      }
      queue.syncAutoSave()
      openGuardedFile(store, { baseline: latin1, draft: `${latin1}?` })
      queue.syncAutoSave()
      const reopened = guardedDocument(store, GUARDED_PATH)
      expect(isAutosaveSuspendedForWorkingDocument(reopened)).toBe(false)
      await queue.queueSave(reopened.id, 'autosave')
      expect(disk.writeFile).toHaveBeenCalledTimes(2)
      expect(toast.warning).toHaveBeenCalledTimes(2)
    } finally {
      queue.dispose()
    }
  }
)
