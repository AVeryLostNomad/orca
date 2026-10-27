// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSourceControlPanelViewState } from './use-panel-view-state'

let container: HTMLDivElement
let root: Root
let toggle: (section: string) => void = () => {}
let collapsed = new Set<string>()

function Probe({ worktreeId }: { worktreeId: string | null }) {
  const viewState = useSourceControlPanelViewState({
    activeWorktreeId: worktreeId,
    settings: null,
    updateSettings: vi.fn()
  })
  toggle = viewState.toggleSection
  collapsed = viewState.collapsedSections
  return null
}

function render(worktreeId: string | null): void {
  act(() => root.render(<Probe worktreeId={worktreeId} />))
}

function remount(worktreeId: string | null): void {
  act(() => root.unmount())
  root = createRoot(container)
  render(worktreeId)
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
})

// Fork default: history, Committed on Branch and Stashes start collapsed.
const DEFAULT_COLLAPSED = ['branch', 'history', 'stashes']
const WT_A_COLLAPSED = ['branch', 'stashes', 'unstaged']

describe('useSourceControlPanelViewState section disclosure', () => {
  it('keeps a worktree choice across remount without leaking it to another worktree', () => {
    render('wt-a')
    expect([...collapsed].sort()).toEqual(DEFAULT_COLLAPSED)
    act(() => toggle('unstaged'))
    act(() => toggle('history'))
    expect([...collapsed].sort()).toEqual(WT_A_COLLAPSED)

    remount('wt-a')
    expect([...collapsed].sort()).toEqual(WT_A_COLLAPSED)

    render('wt-b')
    expect([...collapsed].sort()).toEqual(DEFAULT_COLLAPSED)

    remount('wt-b')
    expect([...collapsed].sort()).toEqual(DEFAULT_COLLAPSED)

    render('wt-a')
    expect([...collapsed].sort()).toEqual(WT_A_COLLAPSED)
  })
})
