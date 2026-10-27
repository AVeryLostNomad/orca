// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SidebarHeader from './SidebarHeader'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const mocks = vi.hoisted(() => {
  const popoverContentProps: { current: Record<string, unknown> | null } = { current: null }
  const shortcutLabel: { current: string | null } = { current: '⌘N' }

  return {
    bucketCounts: { attention: 0, working: 0, done: 0, idle: 0 },
    openWorkspaceCreationComposerWithTourHandoff: vi.fn(),
    createPrototypeAndOpen: vi.fn(),
    popoverContentProps,
    shortcutLabel,
    toast: vi.fn()
  }
})

type MockState = {
  repos: { id: string }[]
  groupBy: string
  sidebarBody: 'workspaces' | 'agents'
  sidebarWidth: number
  setSidebarBody: (body: 'workspaces' | 'agents') => void
  openModal: (modal: string, data?: unknown) => void
  updateSettings: (patch: Record<string, unknown>) => void
  activeContextualTourId: string | null
  activeContextualTourStepIndex?: number
  settings?: {
    experimentalAgentDashboardPopout?: boolean
    agentsSidebarIntroShown?: boolean
    agentsSidebarMigratedFromExperimental?: boolean
    activeRuntimeEnvironmentId?: string | null
  }
}

let mockState: MockState

vi.mock('@/store', () => {
  const useAppStore = (selector: (state: MockState) => unknown) => selector(mockState)
  useAppStore.getState = () => mockState
  return { useAppStore }
})

vi.mock('@/components/dashboard/useAgentBucketCounts', () => ({
  useAgentBucketCounts: () => mocks.bucketCounts
}))

vi.mock('./SidebarWorkspaceOptionsMenu', () => ({
  default: () => <button aria-label="Workspace options" type="button" />
}))

vi.mock('./workspace-options-menu-items', () => ({
  useWorkspaceOptionsFilterBadge: () => ({
    hasAnyFilter: false,
    activeFilterCount: 0,
    activeFilterLabel: '0 filters'
  }),
  WorkspaceOptionsMenuItems: () => null
}))

vi.mock('@/hooks/useShortcutLabel', () => ({
  useShortcutLabel: () => '⌘N',
  useOptionalShortcutLabel: () => mocks.shortcutLabel.current,
  formatOptionalPrimaryShortcutLabel: () => mocks.shortcutLabel.current
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

vi.mock('../contextual-tours/workspace-creation-tour-handoff', () => ({
  openWorkspaceCreationComposerWithTourHandoff: mocks.openWorkspaceCreationComposerWithTourHandoff
}))

vi.mock('sonner', () => ({ toast: mocks.toast }))

vi.mock('./prototype-actions', () => ({
  createPrototypeAndOpen: mocks.createPrototypeAndOpen
}))

// Expose open state directly to isolate this header test from Radix portals.
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children, open }: { children: React.ReactNode; open?: boolean }) => (
    <div data-intro-open={open ? '' : undefined}>{children}</div>
  ),
  PopoverAnchor: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverArrow: () => <div data-testid="popover-arrow" />,
  PopoverContent: ({ children, ...props }: { children: React.ReactNode }) => {
    mocks.popoverContentProps.current = props
    return <>{children}</>
  }
}))

let container: HTMLDivElement
let root: Root

function headerButton(label: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)
  if (!button) {
    throw new Error(`Header button not rendered: ${label}`)
  }
  return button
}

function createButton(): HTMLButtonElement {
  return headerButton('New workspace')
}

function openNewWorkspaceMenu(): void {
  act(() => {
    createButton().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
  })
}

function newWorkspaceMenuItem(label: string): HTMLElement | undefined {
  return [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
    item.textContent?.includes(label)
  )
}

function selectNewWorkspaceMenuItem(label: string): void {
  const item = newWorkspaceMenuItem(label)
  if (!item) {
    throw new Error(`${label} menu item not rendered`)
  }
  act(() => {
    item.click()
  })
}

beforeEach(() => {
  mocks.bucketCounts = { attention: 0, working: 0, done: 0, idle: 0 }
  mocks.openWorkspaceCreationComposerWithTourHandoff.mockClear()
  mocks.createPrototypeAndOpen.mockClear()
  mocks.toast.mockClear()
  mocks.shortcutLabel.current = '⌘N'
  mockState = {
    repos: [],
    groupBy: 'repo',
    sidebarBody: 'workspaces',
    sidebarWidth: 280,
    setSidebarBody: vi.fn(),
    openModal: vi.fn(),
    updateSettings: vi.fn(),
    activeContextualTourId: null,
    settings: {}
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('SidebarHeader', () => {
  it.each(['workspaces', 'agents'] as const)(
    'prioritizes questions, then working, and shows idle zero in the %s view',
    (sidebarBody) => {
      mockState.sidebarBody = sidebarBody
      const render = () => {
        act(() => root.render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />))
        return headerButton(sidebarBody === 'agents' ? 'Turn off activity view' : 'View activity')
      }
      mocks.bucketCounts = { attention: 2, working: 5, done: 3, idle: 4 }
      let button = render()
      expect(button.querySelector('[aria-label="Needs You: 2"]')?.textContent).toBe('2')
      expect(button.querySelector('.lucide-message-circle-question-mark')).toBeTruthy()
      expect(button.querySelector('[aria-label="Working: 5"]')).toBeNull()

      mocks.bucketCounts.attention = 0
      button = render()
      expect(button.querySelector('[aria-label="Working: 5"]')?.textContent).toBe('5')
      expect(button.querySelector('.lucide-message-circle-question-mark')).toBeNull()

      mocks.bucketCounts.working = 0
      button = render()
      expect(button.querySelector('[aria-label="Idle: 0"]')?.textContent).toBe('0')
      expect(button.querySelector('.lucide-message-circle-question-mark')).toBeNull()
      expect(button.getAttribute('aria-describedby')).toBe(
        button.querySelector('[aria-label="Idle: 0"]')?.id
      )
    }
  )

  it.each([9, 12, 99, 100])('keeps the working count accessible at %s agents', (working) => {
    mocks.bucketCounts.working = working
    act(() => root.render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />))
    const button = headerButton('View activity')
    const status = button.querySelector(`[aria-label="Working: ${working}"]`)
    expect(status?.textContent).toBe(working > 99 ? '99+' : String(working))
    expect(button.getAttribute('aria-describedby')).toBe(status?.id)
  })

  it('keeps New workspace clickable with zero projects, since the composer adds the first one', () => {
    act(() => {
      root.render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)
    })

    expect(createButton().disabled).toBe(false)
    openNewWorkspaceMenu()
    selectNewWorkspaceMenuItem('New Worktree')

    expect(mocks.openWorkspaceCreationComposerWithTourHandoff).toHaveBeenCalledTimes(1)
  })

  it('reaches Add project in one click', async () => {
    act(() => {
      root.render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)
    })

    expect(headerButton('New workspace')).toBeTruthy()

    await act(async () => {
      headerButton('Add project').click()
    })

    expect(mockState.openModal).toHaveBeenCalledWith('add-repo')
    expect(mocks.openWorkspaceCreationComposerWithTourHandoff).not.toHaveBeenCalled()
  })

  it('offers New Prototype after New Worktree for local projects', () => {
    act(() => {
      root.render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)
    })

    openNewWorkspaceMenu()
    const labels = [...document.body.querySelectorAll('[role="menuitem"]')].map(
      (item) => item.textContent
    )
    expect(labels.map((label) => label?.replace('⌘N', ''))).toEqual([
      'New Worktree',
      'New Prototype'
    ])

    selectNewWorkspaceMenuItem('New Prototype')
    expect(mocks.createPrototypeAndOpen).toHaveBeenCalledTimes(1)
    expect(mocks.openWorkspaceCreationComposerWithTourHandoff).not.toHaveBeenCalled()
  })

  it('hides New Prototype when a remote runtime owns projects', () => {
    mockState.settings = { activeRuntimeEnvironmentId: 'env-1' }
    act(() => {
      root.render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)
    })

    openNewWorkspaceMenu()
    expect(newWorkspaceMenuItem('New Worktree')).toBeTruthy()
    expect(newWorkspaceMenuItem('New Prototype')).toBeUndefined()
  })

  it('opens the composer directly while the parallel-work tour points at the button', () => {
    mockState.activeContextualTourId = 'workspace-agent-sessions'
    mockState.activeContextualTourStepIndex = 1
    act(() => {
      root.render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)
    })

    openNewWorkspaceMenu()
    expect(mocks.openWorkspaceCreationComposerWithTourHandoff).toHaveBeenCalledTimes(1)
    expect(newWorkspaceMenuItem('New Worktree')).toBeUndefined()
  })
})
