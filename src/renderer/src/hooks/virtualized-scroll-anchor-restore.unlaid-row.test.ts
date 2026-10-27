import { describe, expect, it, vi } from 'vitest'
import { runVirtualizedScrollAnchorRestore } from './virtualized-scroll-anchor-restore'

const VIEWPORT_HEIGHT = 1000
const SLOT_SIZE = 4000
const ROW_KEYS = ['a', 'b', 'c']

/** Rows sit in their virtual slots, but the anchored row's DOM box still shows a short loading strip. */
function restoreWithDomHeight(domHeight: number, scrollTop = 0) {
  const el = {
    clientHeight: VIEWPORT_HEIGHT,
    scrollHeight: SLOT_SIZE * ROW_KEYS.length,
    scrollTop,
    getBoundingClientRect: () => ({ top: 0, bottom: VIEWPORT_HEIGHT, height: VIEWPORT_HEIGHT }),
    querySelectorAll: () => elements
  }
  const elements = ROW_KEYS.map((key, index) => ({
    isConnected: true,
    rowKey: key,
    getBoundingClientRect: () => {
      const top = index * SLOT_SIZE - el.scrollTop
      const height = key === 'b' ? domHeight : SLOT_SIZE
      return { top, bottom: top + height, height }
    }
  }))
  const pendingRestoreRef = { current: false }
  const recordScrollAnchor = vi.fn()
  const anchor = { key: 'b', offset: 2500, scrollTop: SLOT_SIZE + 2500 }
  runVirtualizedScrollAnchorRestore({
    anchor,
    el,
    getItemElementKey: (element: { rowKey: string }) => element.rowKey,
    itemElementSelector: '[data-row]',
    pendingRestoreRef,
    recordScrollAnchor,
    rowIndexByKey: new Map(ROW_KEYS.map((key, index) => [key, index])),
    scrollOffsetRef: { current: 0 },
    virtualizer: {
      getVirtualItems: () =>
        ROW_KEYS.map((_, index) => ({
          index,
          size: SLOT_SIZE,
          start: index * SLOT_SIZE,
          end: (index + 1) * SLOT_SIZE
        })),
      isScrolling: false,
      scrollToIndex: vi.fn()
    }
  } as never)
  return { anchor, el, pendingRestoreRef, recordScrollAnchor }
}

const LANDED = SLOT_SIZE + 2500

describe('runVirtualizedScrollAnchorRestore with a row still laying out', () => {
  it.each([0, LANDED])(
    'holds the anchor on its measured slot while the row is short (from %i)',
    (scrollTop) => {
      const result = restoreWithDomHeight(71, scrollTop)

      expect(result.el.scrollTop).toBe(LANDED)
      expect(result.pendingRestoreRef.current).toBe(true)
      expect(result.recordScrollAnchor).not.toHaveBeenCalled()
      expect(result.anchor.key).toBe('b')
    }
  )

  it('confirms from the DOM once the row reaches its slot size', () => {
    const result = restoreWithDomHeight(SLOT_SIZE, LANDED)

    expect(result.el.scrollTop).toBe(LANDED)
    expect(result.pendingRestoreRef.current).toBe(false)
    expect(result.recordScrollAnchor).toHaveBeenCalledWith(LANDED)
  })
})
