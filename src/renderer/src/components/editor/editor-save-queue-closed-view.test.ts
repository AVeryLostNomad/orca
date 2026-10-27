import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDiskBaselineSignature } from '../../../../shared/disk-baseline-signature'
import {
  CLOSED_VIEW_PATH,
  createClosedViewHarness,
  type ClosedViewHarness
} from './editor-save-closed-view.test-fixture'

vi.mock('@/lib/connection-context', () => ({ getConnectionIdForFile: () => undefined }))

describe('editor save queue: the saving view closes mid-write', () => {
  let h: ClosedViewHarness

  beforeEach(() => {
    h = createClosedViewHarness()
    expect(h.document('A').id).toBe(h.document('B').id)
  })

  afterEach(() => h.dispose())

  it('undoing the saved edit in the other view leaves it dirty, so closing it asks', async () => {
    h.type('A', 'edit')
    h.holdNextWrite()
    const saved = h.queue.queueSave(h.document('A').id)
    await vi.advanceTimersByTimeAsync(0)
    h.closeView('A')
    h.release()
    await saved

    expect(h.disk.files.get(CLOSED_VIEW_PATH)).toBe('edit')
    expect(h.document('B')).toMatchObject({
      isDirty: false,
      content: 'edit',
      lastKnownDiskSignature: getDiskBaselineSignature('edit')
    })

    h.type('B', 'disk')
    expect(h.document('B').isDirty).toBe(true)
    expect(h.disk.files.get(CLOSED_VIEW_PATH)).toBe('edit')
  })

  it('keeps the other view dirty when it typed past the write', async () => {
    h.type('A', 'edit')
    h.holdNextWrite()
    const saved = h.queue.queueSave(h.document('A').id)
    await vi.advanceTimersByTimeAsync(0)
    h.closeView('A')
    h.type('B', 'edit, more')
    h.release()
    await saved

    expect(h.document('B')).toMatchObject({
      isDirty: true,
      content: 'edit, more',
      lastKnownDiskSignature: getDiskBaselineSignature('edit')
    })
  })

  it('a save queued behind the running one still writes the document after its view closes', async () => {
    h.type('A', 'edit')
    h.holdNextWrite()
    const first = h.queue.queueSave(h.document('A').id)
    await vi.advanceTimersByTimeAsync(0)
    h.type('A', 'edit 2')
    const second = h.queue.queueSave(h.document('A').id)
    h.closeView('A')
    h.release()
    await Promise.all([first, second])

    expect(h.disk.files.get(CLOSED_VIEW_PATH)).toBe('edit 2')
    expect(h.document('B')).toMatchObject({
      isDirty: false,
      lastKnownDiskSignature: getDiskBaselineSignature('edit 2')
    })
  })

  it('settles the document when the view left is a rich markdown view', async () => {
    h.store.getState().setMarkdownViewMode(h.store.getState().openFiles[1]!.id, 'rich')
    h.type('A', 'edit')
    h.holdNextWrite()
    const saved = h.queue.queueSave(h.document('A').id)
    await vi.advanceTimersByTimeAsync(0)
    h.closeView('A')
    h.release()
    await saved

    expect(h.document('B')).toMatchObject({
      isDirty: false,
      lastKnownDiskSignature: getDiskBaselineSignature('edit')
    })
  })

  it('a refused write banners the view left', async () => {
    h.type('A', 'edit')
    h.holdNextWrite(true)
    const saved = h.queue.queueSave(h.document('A').id)
    await vi.advanceTimersByTimeAsync(0)
    h.closeView('A')
    h.release()
    await expect(saved).rejects.toThrow(/changed on disk/)

    expect(h.document('B')).toMatchObject({
      externalMutation: 'changed',
      isDirty: true,
      content: 'edit'
    })
  })
})
