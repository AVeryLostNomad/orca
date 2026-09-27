import { useLayoutEffect, useReducer } from 'react'
import type React from 'react'
import type { Virtualizer } from '@tanstack/react-virtual'

type VerticalScrollElement = Pick<Element, 'clientHeight' | 'scrollHeight' | 'scrollTop'>

/**
 * TanStack keeps offsets the browser clamped: a seeded `initialOffset` after remount and
 * eager size-adjustment writes land on an unscrollable viewport without firing a scroll
 * event. Returns true when the virtualizer was snapped back to the real DOM offset.
 */
export function syncClampedVirtualScrollOffset(
  virtualizer: Pick<Virtualizer<Element, Element>, 'scrollOffset'>,
  element: VerticalScrollElement
): boolean {
  const offset = virtualizer.scrollOffset
  if (offset === null) {
    return false
  }
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
  if (offset <= maxScrollTop + 1) {
    return false
  }
  virtualizer.scrollOffset = element.scrollTop
  return true
}

export function useClampedVirtualScrollOffsetSync<TItemElement extends Element>(
  virtualizer: Virtualizer<HTMLDivElement, TItemElement>,
  scrollElementRef: React.RefObject<HTMLDivElement | null>
): void {
  const [, rerender] = useReducer((tick: number) => tick + 1, 0)
  const scrollOffset = virtualizer.scrollOffset
  const totalSize = virtualizer.getTotalSize()
  useLayoutEffect(() => {
    const element = scrollElementRef.current
    if (element && syncClampedVirtualScrollOffset(virtualizer, element)) {
      // Why: TanStack only recomputes its range on its own notify; re-render so range and sticky slots read the synced offset.
      rerender()
    }
  }, [scrollElementRef, scrollOffset, totalSize, virtualizer])
}
