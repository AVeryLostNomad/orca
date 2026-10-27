// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RepositoryIconSearchGrid } from './RepositoryIconSearchGrid'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function flushCatalogLoad(): Promise<void> {
  // Why: the Font Awesome packs load through dynamic imports, so wait for the loading state to clear.
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(container.textContent).not.toContain('Loading Font Awesome icons')
  })
}

function setQuery(value: string): void {
  const input = container.querySelector<HTMLInputElement>('input')!
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('RepositoryIconSearchGrid', () => {
  it('shows the curated lucide set until a query is typed, then searches Font Awesome', async () => {
    const onSetIcon = vi.fn()
    await act(async () => {
      root.render(
        <TooltipProvider>
          <RepositoryIconSearchGrid
            selectedLucideName="Folder"
            selectedFontAwesome={null}
            onSetIcon={onSetIcon}
          />
        </TooltipProvider>
      )
    })
    expect(container.querySelector('button[aria-label="Use Folder icon"]')).not.toBeNull()

    setQuery('github')
    await flushCatalogLoad()
    const brand = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Use github · brands icon"]'
    )
    expect(brand).not.toBeNull()
    expect(brand!.querySelector('svg path')).not.toBeNull()

    act(() => brand!.click())
    expect(onSetIcon).toHaveBeenCalledWith({ type: 'fontawesome', name: 'github', style: 'brands' })
  })

  it('highlights the persisted Font Awesome icon and reports empty searches', async () => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <RepositoryIconSearchGrid
            selectedLucideName={null}
            selectedFontAwesome={{ name: 'rocket', style: 'solid' }}
            onSetIcon={vi.fn()}
          />
        </TooltipProvider>
      )
    })
    await flushCatalogLoad()
    expect(
      container.querySelector('button[aria-label="Use rocket · solid icon"][aria-pressed="true"]')
    ).not.toBeNull()

    setQuery('zzzz-no-such-icon')
    expect(container.textContent).toContain('No icons match')
  })
})
