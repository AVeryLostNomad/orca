// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { installPierreMonacoClickScrollGuard } from './pierre-monaco-click-scroll-guard'

function mountScroller() {
  const list = document.createElement('div')
  const host = document.createElement('div')
  const container = document.createElement('div')
  const line = document.createElement('span')
  container.append(line)
  list.append(host, container)
  document.body.append(list)
  Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 5200 })
  return { container, host, line, list }
}

describe('installPierreMonacoClickScrollGuard', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('undoes a scroll the editor focus made while the press was handled', () => {
    const { container, host, line, list } = mountScroller()
    const dispose = installPierreMonacoClickScrollGuard(container, host)
    line.addEventListener('mousedown', () => {
      list.scrollTop = 3158
    })

    line.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    line.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    expect(list.scrollTop).toBe(5200)
    dispose()
  })

  it('leaves scrolls alone when the press started outside the editor', () => {
    const { container, host, list } = mountScroller()
    const dispose = installPierreMonacoClickScrollGuard(container, host)
    const outside = document.createElement('button')
    document.body.append(outside)

    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    list.scrollTop = 4000
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    expect(list.scrollTop).toBe(4000)
    dispose()
  })
})
