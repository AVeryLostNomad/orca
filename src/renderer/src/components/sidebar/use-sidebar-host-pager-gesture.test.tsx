// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSidebarHostPagerGesture } from './use-sidebar-host-pager-gesture'

const PAGE_WIDTH = 280

function Harness(props: {
  activeIndex: number
  pageCount: number
  onNavigate: (index: number) => void
}): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  useSidebarHostPagerGesture({ viewportRef, trackRef, ...props })
  return (
    <div ref={viewportRef} data-testid="viewport">
      <div ref={trackRef} />
    </div>
  )
}

function swipe(target: Element, ...deltas: [number, number?][]): void {
  act(() => {
    for (const [deltaX, deltaY = 0] of deltas) {
      target.dispatchEvent(new WheelEvent('wheel', { deltaX, deltaY, bubbles: true }))
    }
  })
}

function settle(): void {
  act(() => {
    vi.advanceTimersByTime(500)
  })
}

function mount(activeIndex: number, pageCount = 3) {
  const onNavigate = vi.fn()
  const view = render(
    <Harness activeIndex={activeIndex} pageCount={pageCount} onNavigate={onNavigate} />
  )
  return { onNavigate, viewport: view.getByTestId('viewport') }
}

describe('useSidebarHostPagerGesture', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => PAGE_WIDTH
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
  })

  it('pages once a swipe passes the commit distance and ignores its momentum tail', () => {
    const { onNavigate, viewport } = mount(0)

    swipe(viewport, [30], [30], [40])
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(1)

    swipe(viewport, [40], [40], [40], [40])
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('pages a released short swipe only past the release distance', () => {
    const { onNavigate, viewport } = mount(1)

    swipe(viewport, [-20])
    settle()
    expect(onNavigate).not.toHaveBeenCalled()

    swipe(viewport, [-40])
    settle()
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(0)
  })

  it('leaves a gesture that starts vertical to the list scroller', () => {
    const { onNavigate, viewport } = mount(0)

    swipe(viewport, [4, 30], [200, 0])
    expect(onNavigate).not.toHaveBeenCalled()

    settle()
    swipe(viewport, [200])
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('never pages past the first or last host', () => {
    const first = mount(0)
    swipe(first.viewport, [-300])
    settle()
    expect(first.onNavigate).not.toHaveBeenCalled()
    cleanup()

    const last = mount(2)
    swipe(last.viewport, [300])
    settle()
    expect(last.onNavigate).not.toHaveBeenCalled()
  })
})
