// @vitest-environment happy-dom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import { RecoverableRenderErrorBoundary } from '@/components/error-boundaries/RecoverableRenderErrorBoundary'
import { RightSidebarPanelContent } from './right-sidebar-panel-content'

const fixture = vi.hoisted(() => ({ fail: false, mounts: 0, report: vi.fn() }))
type PanelState = { activeWorktreeId: string; rightSidebarExplorerView: string }
const useState = create<PanelState>(() => ({
  activeWorktreeId: 'first',
  rightSidebarExplorerView: 'files'
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: PanelState) => unknown) => useState(selector)
}))
vi.mock('@/lib/react-error-boundary-reporting', () => ({
  reportReactErrorBoundaryCrash: fixture.report
}))
vi.mock('./FileExplorer', () => ({
  default: function Explorer() {
    useEffect(() => {
      fixture.mounts++
      if (fixture.fail) {
        throw new Error('Explorer tree failed')
      }
    }, [])
    return <div data-explorer>Files</div>
  }
}))
vi.mock('./SourceControl', () => ({ default: () => <div data-source-control>Changes</div> }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('right sidebar panel recovery', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    fixture.fail = false
    fixture.mounts = 0
    fixture.report.mockReset()
    useState.setState({ activeWorktreeId: 'first', rightSidebarExplorerView: 'files' })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  async function render(tab: 'explorer' | 'source-control' = 'explorer', open = true) {
    await act(async () => {
      root.render(
        <RecoverableRenderErrorBoundary boundaryId="shell" surface="right-sidebar">
          <button data-navigation>Sidebar navigation</button>
          {open && <RightSidebarPanelContent effectiveTab={tab} rightSidebarOpen />}
        </RecoverableRenderErrorBoundary>
      )
    })
  }

  it('contains effect failures below navigation and permits switching panels', async () => {
    fixture.fail = true
    await render()
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(container.querySelector('[data-navigation]')).not.toBeNull()
    expect(fixture.report).toHaveBeenCalledWith(
      expect.objectContaining({ boundaryId: 'right-sidebar.explorer' })
    )
    await render('source-control')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector('[data-source-control]')).not.toBeNull()
  })

  it.each(['workspace', 'subview', 'reopen', 'retry'] as const)(
    'recovers a failed panel after %s',
    async (action) => {
      fixture.fail = true
      await render()
      expect(container.querySelector('[data-explorer]')).toBeNull()
      fixture.fail = false
      if (action === 'reopen') {
        await render('explorer', false)
        await render()
      } else {
        await act(async () => {
          if (action === 'workspace') {
            useState.setState({ activeWorktreeId: 'folder:second' })
          }
          if (action === 'subview') {
            useState.setState({ rightSidebarExplorerView: 'search' })
          }
          if (action === 'retry') {
            container.querySelector<HTMLButtonElement>('[role="alert"] button')!.click()
          }
        })
      }
      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(container.querySelector('[data-explorer]')).not.toBeNull()
    }
  )

  it('does not remount healthy panels when switching workspace or explorer subview', async () => {
    await render()
    expect(fixture.mounts).toBe(1)
    await act(async () => {
      useState.setState({ activeWorktreeId: 'second', rightSidebarExplorerView: 'search' })
    })
    expect(container.querySelector('[data-explorer]')).not.toBeNull()
    expect(fixture.mounts).toBe(1)
  })
})
