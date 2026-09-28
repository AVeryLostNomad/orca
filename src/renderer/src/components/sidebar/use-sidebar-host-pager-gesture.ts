import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const SETTLE_TRANSITION = 'transform 340ms cubic-bezier(0.22, 1, 0.36, 1)'
// Why: trackpad momentum keeps emitting wheel events after the fingers lift; a
// gesture only ends once the stream goes quiet.
const GESTURE_IDLE_MS = 140
const SETTLE_FALLBACK_MS = 420
// Past this fraction of the width the swipe commits without waiting for release.
const COMMIT_FRACTION = 0.32
// Released below the commit fraction, a swipe still pages once it clears this distance.
const RELEASE_FRACTION = 0.12
const MIN_RELEASE_PX = 24
const EDGE_RESISTANCE = 0.28
const MAX_EDGE_FRACTION = 0.18
const WHEEL_LINE_PX = 16

type GesturePhase = 'idle' | 'tracking' | 'locked' | 'ignored'

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/** A horizontal wheel over a natively scrollable strip belongs to that strip, not the pager. */
function scrollsHorizontally(target: EventTarget | null, boundary: HTMLElement): boolean {
  for (
    let element = target instanceof Element ? target : null;
    element && element !== boundary;
    element = element.parentElement
  ) {
    if (element.scrollWidth > element.clientWidth + 1) {
      const overflowX = getComputedStyle(element).overflowX
      if (overflowX === 'auto' || overflowX === 'scroll') {
        return true
      }
    }
  }
  return false
}

function wheelDeltaXPx(event: WheelEvent, pageWidth: number): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaX * WHEEL_LINE_PX
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaX * pageWidth
  }
  return event.deltaX
}

/**
 * Drives the sidebar host pager: the track follows horizontal trackpad/Shift+wheel
 * scrolling, then snaps to a page. Positions are written straight to the track's
 * style so a swipe never re-renders the page lists.
 */
export function useSidebarHostPagerGesture(args: {
  viewportRef: React.RefObject<HTMLDivElement | null>
  trackRef: React.RefObject<HTMLDivElement | null>
  pageCount: number
  activeIndex: number
  onNavigate: (index: number) => void
}): { engaged: boolean; settleFromIndex: number | null } {
  const { viewportRef, trackRef, pageCount, activeIndex } = args
  const [engaged, setEngaged] = useState(false)
  const [settleFromIndex, setSettleFromIndex] = useState<number | null>(null)
  const latest = useRef({ pageCount, activeIndex, onNavigate: args.onNavigate })
  useLayoutEffect(() => {
    latest.current = { pageCount, activeIndex, onNavigate: args.onNavigate }
  })
  const gesture = useRef({ phase: 'idle' as GesturePhase, offsetPx: 0 })
  const idleTimerRef = useRef<number | null>(null)
  const settleTimerRef = useRef<number | null>(null)
  const frameRef = useRef<number | null>(null)
  const renderedIndexRef = useRef<number | null>(null)

  const writeTrack = useCallback(
    (index: number, offsetPx: number, animate: boolean) => {
      const track = trackRef.current
      if (!track) {
        return
      }
      track.style.transition = animate && !prefersReducedMotion() ? SETTLE_TRANSITION : 'none'
      track.style.transform = `translate3d(calc(${-index * 100}% - ${offsetPx}px), 0, 0)`
    },
    [trackRef]
  )

  const finishSettle = useCallback(() => {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
    }
    if (gesture.current.phase === 'idle') {
      setEngaged(false)
      setSettleFromIndex(null)
    }
  }, [])

  const settle = useCallback(
    (fromIndex: number, targetIndex: number) => {
      gesture.current.offsetPx = 0
      renderedIndexRef.current = targetIndex
      writeTrack(targetIndex, 0, true)
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current)
      }
      settleTimerRef.current = window.setTimeout(finishSettle, SETTLE_FALLBACK_MS)
      if (targetIndex !== fromIndex) {
        latest.current.onNavigate(targetIndex)
      }
    },
    [finishSettle, writeTrack]
  )

  // Pip clicks, reveals and page-list changes move the track here; swipes already did.
  useLayoutEffect(() => {
    const previousIndex = renderedIndexRef.current
    if (previousIndex === activeIndex) {
      return
    }
    renderedIndexRef.current = activeIndex
    if (previousIndex === null) {
      writeTrack(activeIndex, 0, false)
      return
    }
    setEngaged(true)
    setSettleFromIndex(previousIndex)
    settle(activeIndex, activeIndex)
  }, [activeIndex, settle, writeTrack])

  useEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track) {
      return
    }
    const onTransitionEnd = (event: TransitionEvent): void => {
      if (event.target === track && event.propertyName === 'transform') {
        finishSettle()
      }
    }
    const endGesture = (): void => {
      idleTimerRef.current = null
      const state = gesture.current
      const { activeIndex: index, pageCount: count } = latest.current
      if (state.phase === 'tracking') {
        const width = viewport.clientWidth || 1
        const direction = Math.sign(state.offsetPx)
        const target = index + direction
        const cleared =
          Math.abs(state.offsetPx) >= Math.max(MIN_RELEASE_PX, width * RELEASE_FRACTION)
        state.phase = 'idle'
        settle(index, cleared && target >= 0 && target < count ? target : index)
        return
      }
      state.phase = 'idle'
      if (settleTimerRef.current === null) {
        finishSettle()
      }
    }
    const onWheel = (event: WheelEvent): void => {
      const state = gesture.current
      const { activeIndex: index, pageCount: count } = latest.current
      if (count < 2 || event.ctrlKey) {
        return
      }
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current)
      }
      idleTimerRef.current = window.setTimeout(endGesture, GESTURE_IDLE_MS)
      if (state.phase === 'idle') {
        const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY)
        // Why: a gesture that starts vertical stays a list scroll until it goes quiet.
        state.phase =
          horizontal && !scrollsHorizontally(event.target, viewport) ? 'tracking' : 'ignored'
        if (state.phase === 'tracking') {
          state.offsetPx = 0
          setEngaged(true)
        }
      }
      if (state.phase !== 'tracking') {
        return
      }
      const width = viewport.clientWidth || 1
      state.offsetPx += wheelDeltaXPx(event, width)
      const pastEdge =
        (index === 0 && state.offsetPx < 0) || (index === count - 1 && state.offsetPx > 0)
      if (!pastEdge && Math.abs(state.offsetPx) >= width * COMMIT_FRACTION) {
        // Why lock: the momentum tail would otherwise page again on the next page.
        state.phase = 'locked'
        settle(index, index + Math.sign(state.offsetPx))
        return
      }
      const visibleOffset = pastEdge
        ? Math.sign(state.offsetPx) *
          Math.min(Math.abs(state.offsetPx) * EDGE_RESISTANCE, width * MAX_EDGE_FRACTION)
        : state.offsetPx
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
      }
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        if (gesture.current.phase === 'tracking') {
          writeTrack(latest.current.activeIndex, visibleOffset, false)
        }
      })
    }
    viewport.addEventListener('wheel', onWheel, { passive: true })
    track.addEventListener('transitionend', onTransitionEnd)
    return () => {
      viewport.removeEventListener('wheel', onWheel)
      track.removeEventListener('transitionend', onTransitionEnd)
      for (const timer of [idleTimerRef, settleTimerRef]) {
        if (timer.current !== null) {
          window.clearTimeout(timer.current)
          timer.current = null
        }
      }
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [finishSettle, settle, trackRef, viewportRef, writeTrack])

  return { engaged, settleFromIndex }
}
