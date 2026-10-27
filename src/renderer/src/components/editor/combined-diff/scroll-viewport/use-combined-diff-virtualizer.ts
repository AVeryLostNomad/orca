import { useLayoutEffect } from 'react'
import type React from 'react'
import { elementScroll, useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import type { ProgrammaticScrollMarks } from '@/hooks/programmatic-scroll-marks'
import { measureVirtualRowRetainingHiddenSize } from '@/hooks/virtualized-hidden-row-measurement'
import type { DiffSection } from '../../diff-section-types'
import { getDiffSectionRowEstimatedHeight } from '../../diff-section-layout'
import { getCombinedDiffRenderRange } from './combined-diff-render-range'

const COMBINED_DIFF_OVERSCAN = 5

/** Pierre rows show a short strip until their comparison resolves; keep the row's known size so remounts cannot collapse the list. */
function measureCombinedDiffRow(
  element: Element,
  entry: ResizeObserverEntry | undefined,
  instance: Virtualizer<HTMLDivElement, Element>
): number {
  if (element.querySelector('[data-pierre-diff-pending]')) {
    const index = instance.indexFromElement(element)
    return (
      instance.itemSizeCache.get(instance.options.getItemKey(index)) ??
      instance.options.estimateSize(index)
    )
  }
  return measureVirtualRowRetainingHiddenSize(element, entry, instance)
}

export function useCombinedDiffVirtualizer({
  generation,
  programmaticScrollMarks,
  renderedIndicesRef,
  rowKeys,
  scrollContainerRef,
  scrollOffsetRef,
  sectionHeights,
  sections,
  sideBySide
}: {
  generation: number
  programmaticScrollMarks: ProgrammaticScrollMarks
  renderedIndicesRef: React.RefObject<Set<number>>
  rowKeys: readonly string[]
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  scrollOffsetRef: React.RefObject<number>
  sectionHeights: Record<number, number>
  sections: DiffSection[]
  sideBySide: boolean
}): Virtualizer<HTMLDivElement, Element> {
  const estimateSize = (index: number): number => {
    const section = sections[index]
    return section ? getDiffSectionRowEstimatedHeight(section, sectionHeights[index]) : 88
  }
  const virtualizer = useVirtualizer({
    count: sections.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize,
    // Retain known heights while rows are hidden or still awaiting their diff so anchors survive reopening.
    measureElement: measureCombinedDiffRow,
    // Offscreen Monaco sections render their full height; bound that work by pixels, too.
    rangeExtractor: (range) =>
      getCombinedDiffRenderRange(
        range,
        estimateSize,
        scrollContainerRef.current?.clientHeight ?? 0
      ),
    overscan: COMBINED_DIFF_OVERSCAN,
    initialOffset: () => scrollOffsetRef.current,
    // Mark virtualizer scrolls so their events cannot be mistaken for user intent.
    scrollToFn: (offset, options, instance) => {
      const target = offset + (options.adjustments ?? 0)
      // Writing the current position emits no event; an unused mark could later claim a real user scroll.
      if (instance.scrollElement?.scrollTop !== target) {
        programmaticScrollMarks.mark(target)
      }
      elementScroll(offset, options, instance)
    },
    // Prebuild keys per section change because TanStack requests every key on each measurement pass.
    getItemKey: (index) => rowKeys[index] ?? `${index}:${generation}`
  })

  // Publish onscreen indices after commit so retry can read them without making render impure or depending on the virtualizer.
  const virtualItems = virtualizer.getVirtualItems()
  useLayoutEffect(() => {
    renderedIndicesRef.current = new Set(virtualItems.map((item) => item.index))
  }, [renderedIndicesRef, virtualItems])

  useLayoutEffect(() => {
    // Layout mode changes Monaco row heights; measure on mode changes rather than every section load.
    virtualizer.measure()
  }, [sideBySide, virtualizer])

  return virtualizer
}
