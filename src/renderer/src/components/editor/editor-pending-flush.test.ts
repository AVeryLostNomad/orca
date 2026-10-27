import { expect, it, vi } from 'vitest'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import {
  flushPendingEditorChangeAt,
  registerPendingEditorFlush
} from './editor-pending-flush-registry'

const doc = (id: string): WorkingDocumentId => id as WorkingDocumentId

it('keeps one producer per surface and independently cleans up registrations', () => {
  const earlier = vi.fn()
  const later = vi.fn()
  const removeEarlier = registerPendingEditorFlush(doc('legacy'), 'pane', 1, earlier)
  const removeLater = registerPendingEditorFlush(doc('legacy'), 'pane', 1, later)
  try {
    flushPendingEditorChangeAt(doc('legacy'), () => 1)
    expect(earlier).not.toHaveBeenCalled()
    expect(later).toHaveBeenCalledTimes(1)
    // A stale cleanup must not remove the newer registration for the surface.
    removeEarlier()
    flushPendingEditorChangeAt(doc('legacy'), () => 1)
    expect(later).toHaveBeenCalledTimes(2)
  } finally {
    removeEarlier()
    removeLater()
  }
  flushPendingEditorChangeAt(doc('legacy'), () => 1)
  expect(later).toHaveBeenCalledTimes(2)
})

it('flushes every surface of the document at its current revision, except the asking one', () => {
  const monaco = vi.fn()
  const rich = vi.fn()
  const staleRich = vi.fn()
  const other = vi.fn()
  const removers = [
    registerPendingEditorFlush(doc('panes'), 'monaco', 2, monaco),
    registerPendingEditorFlush(doc('panes'), 'rich', 2, rich),
    // A producer synchronized to an older revision must not overwrite newer text.
    registerPendingEditorFlush(doc('panes'), 'stale-rich', 1, staleRich),
    registerPendingEditorFlush(doc('other'), 'monaco', 2, other)
  ]
  try {
    flushPendingEditorChangeAt(doc('panes'), () => 2, 'monaco')
    expect(monaco).not.toHaveBeenCalled()
    expect(rich).toHaveBeenCalledTimes(1)
    expect(staleRich).not.toHaveBeenCalled()
    expect(other).not.toHaveBeenCalled()
  } finally {
    removers.forEach((remove) => remove())
  }
})

it('leaves an active input alone under autosave but flushes it for explicit saves', () => {
  const cell = vi.fn()
  const remove = registerPendingEditorFlush(doc('csv'), 'csv', 1, cell, { skipOnAutosave: true })
  try {
    flushPendingEditorChangeAt(doc('csv'), () => 1, undefined, true)
    expect(cell).not.toHaveBeenCalled()
    flushPendingEditorChangeAt(doc('csv'), () => 1)
    expect(cell).toHaveBeenCalledTimes(1)
  } finally {
    remove()
  }
})
