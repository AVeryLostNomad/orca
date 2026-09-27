import { describe, expect, it } from 'vitest'
import { Virtualizer, type Range } from '@tanstack/react-virtual'
import { syncClampedVirtualScrollOffset } from './virtualizer-clamped-scroll-offset'

const ROW_HEIGHT = 38

function createVirtualizer(args: {
  element: { clientHeight: number; scrollHeight: number; scrollTop: number }
  initialOffset: number
}): { virtualizer: Virtualizer<Element, Element>; ranges: Range[] } {
  const ranges: Range[] = []
  const element = {
    ...args.element,
    ownerDocument: { defaultView: globalThis },
    scrollTo: () => {
      // The browser clamps; an unchanged scrollTop fires no scroll event.
    }
  } as unknown as Element
  const virtualizer = new Virtualizer<Element, Element>({
    count: 10,
    getScrollElement: () => element,
    estimateSize: () => ROW_HEIGHT,
    scrollToFn: () => {},
    observeElementRect: (_instance, callback) => {
      callback({ width: 280, height: args.element.clientHeight })
      return () => {}
    },
    observeElementOffset: () => () => {},
    initialOffset: args.initialOffset,
    overscan: 0,
    rangeExtractor: (range) => {
      ranges.push(range)
      return Array.from(
        { length: range.endIndex - range.startIndex + 1 },
        (_, i) => range.startIndex + i
      )
    }
  })
  virtualizer._willUpdate()
  return { virtualizer, ranges }
}

describe('syncClampedVirtualScrollOffset', () => {
  it('snaps a remount-seeded offset the viewport cannot reach back to the DOM offset', () => {
    const element = { clientHeight: 600, scrollHeight: 380, scrollTop: 0 }
    const { virtualizer, ranges } = createVirtualizer({ element, initialOffset: 76 })
    virtualizer.getVirtualItems()
    expect(ranges.at(-1)?.startIndex).toBe(2)

    expect(syncClampedVirtualScrollOffset(virtualizer, element)).toBe(true)
    virtualizer.getVirtualItems()
    expect(virtualizer.scrollOffset).toBe(0)
    expect(ranges.at(-1)?.startIndex).toBe(0)
  })

  it('keeps reachable offsets so in-flight scroll events stay authoritative', () => {
    const element = { clientHeight: 200, scrollHeight: 380, scrollTop: 0 }
    const { virtualizer } = createVirtualizer({ element, initialOffset: 76 })
    virtualizer.getVirtualItems()

    expect(syncClampedVirtualScrollOffset(virtualizer, element)).toBe(false)
    expect(virtualizer.scrollOffset).toBe(76)
  })
})
