// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SidebarHeader from './SidebarHeader'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  openWorkspaceCreationComposerWithTourHandoff: vi.fn(),
  createPrototypeAndOpen: vi.fn(),
  runtimeTargetKind: { current: 'local' as 'local' | 'environment' },
  popoverContentProps: { current: null as Record<string, unknown> | null },
  toast: vi.fn()
}))

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
  }
}

let mockState: MockState

vi.mock('@/store', () => {
  const useAppStore = (selector: (state: MockState) => unknown) => selector(mockState)
  useAppStore.getState = () => mockState
  return { useAppStore }
})

vi.mock('@/components/dashboard/useAgentBucketCounts', () => ({
  useAgentBucketCounts: () => ({ attention: 0, working: 0, done: 0, idle: 0 })
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
  useOptionalShortcutLabel: () => '⌘N'
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

vi.mock('@/runtime/runtime-rpc-client', () => ({
  getActiveRuntimeTarget: () => ({ kind: mocks.runtimeTargetKind.current })
}))

// Deterministic popover: expose the open flag instead of relying on radix portals.
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

function newWorkspaceButton(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('[aria-label="New workspace"]')
  if (!button) {
    throw new Error('New workspace button not rendered')
  }
  return button
}

function openNewWorkspaceMenu(): void {
  act(() => {
    newWorkspaceButton().dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0 })
    )
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
  mocks.openWorkspaceCreationComposerWithTourHandoff.mockClear()
  mocks.createPrototypeAndOpen.mockClear()
  mocks.runtimeTargetKind.current = 'local'
  mocks.toast.mockClear()
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
  it('keeps New workspace clickable with zero projects, since the composer adds the first one', () => {
    act(() => {
      root.render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)
    })

    expect(newWorkspaceButton().disabled).toBe(false)
    openNewWorkspaceMenu()
    selectNewWorkspaceMenuItem('New Worktree')

    expect(mocks.openWorkspaceCreationComposerWithTourHandoff).toHaveBeenCalledTimes(1)
  })

  it('opens the composer the same way once projects exist', () => {
    mockState.repos = [{ id: 'repo-a' }]
    act(() => {
      root.render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)
    })

    openNewWorkspaceMenu()
    selectNewWorkspaceMenuItem('New Worktree')

    expect(newWorkspaceButton().disabled).toBe(false)
    expect(mocks.openWorkspaceCreationComposerWithTourHandoff).toHaveBeenCalledTimes(1)
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
    mocks.runtimeTargetKind.current = 'environment'
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

  it('opens agent activity from the bell button', () => {
    act(() => {
      root.render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)
    })

    const activityButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="View activity"]'
    )
    expect(activityButton).toBeTruthy()

    act(() => {
      activityButton?.click()
    })

    expect(mockState.setSidebarBody).toHaveBeenCalledWith('agents')
  })

  it('shows the Agents introduction only for migrated users and never offers a hide action', () => {
    mockState.settings = { agentsSidebarMigratedFromExperimental: true }
    act(() => {
      root.render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)
    })

    expect(container.querySelector('[data-intro-open]')).toBeTruthy()
    expect(container.textContent).toContain('Agents are easier to find')
    expect(container.textContent).not.toContain('Hide Agents')

    mockState.settings = {}
    act(() => {
      root.render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)
    })
    expect(container.querySelector('[data-intro-open]')).toBeNull()
  })

  it('turns off agent activity from the active bell button', () => {
    mockState.sidebarBody = 'agents'
    act(() => {
      root.render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)
    })

    const activityButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Turn off activity view"]'
    )
    expect(activityButton?.getAttribute('aria-pressed')).toBe('true')

    act(() => {
      activityButton?.click()
    })

    expect(mockState.setSidebarBody).toHaveBeenCalledWith('workspaces')
  })

  it('uses the legacy title based on workspace grouping', () => {
    act(() => {
      root.render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)
    })

    expect(container.querySelector('[data-sidebar-section-title="projects"]')?.textContent).toBe(
      'Projects'
    )

    mockState.groupBy = 'workspace-status'
    act(() => {
      root.render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)
    })
    expect(container.querySelector('[data-sidebar-section-title="workspaces"]')?.textContent).toBe(
      'Workspaces'
    )
  })

  it('keeps the workspace filter alongside the active bell without Add Project', () => {
    mockState.sidebarBody = 'agents'
    act(() => {
      root.render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)
    })

    expect(container.querySelector('[aria-label="Turn off activity view"]')).toBeTruthy()
    expect(container.querySelector('[aria-label="New workspace"]')).toBeTruthy()
    expect(container.querySelector('[aria-label="Workspace options"]')).toBeNull()
    expect(container.querySelector('[aria-label="Add Project"]')).toBeNull()
  })

  it('keeps the activity bell and actions on one row at the default sidebar width', () => {
    act(() => {
      root.render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)
    })

    const headerRow = container.querySelector('.mt-2')
    const headerClasses = new Set(headerRow?.className.split(/\s+/) ?? [])
    expect(headerClasses.has('flex-wrap')).toBe(false)
    expect(headerClasses.has('h-8')).toBe(true)
    expect(container.querySelector('[aria-label="View activity"]')).toBeTruthy()
    expect(container.querySelector('[aria-label="Add Project"]')).toBeNull()
    expect(container.querySelector('[aria-label="New workspace"]')).toBeTruthy()
  })

  it('keeps New workspace and a more menu on one row at compact width', () => {
    mockState.sidebarWidth = 220
    act(() => {
      root.render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)
    })

    expect(container.querySelector('[aria-label="Add Project"]')).toBeNull()
    expect(container.querySelector('[aria-label="View activity"]')).toBeTruthy()
    expect(container.querySelector('[aria-label="New workspace"]')).toBeTruthy()
    expect(container.querySelector('[aria-label="More workspace actions"]')).toBeTruthy()

    openNewWorkspaceMenu()
    selectNewWorkspaceMenuItem('New Worktree')
    expect(mocks.openWorkspaceCreationComposerWithTourHandoff).toHaveBeenCalledTimes(1)
  })

  it('does not reset a persisted agents body before settings hydrate', () => {
    mockState.settings = undefined
    mockState.sidebarBody = 'agents'
    act(() => {
      root.render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)
    })

    expect(mockState.setSidebarBody).not.toHaveBeenCalled()
  })

  it('does not expose the deprecated full Agents view in agents mode', () => {
    mockState.settings = { agentsSidebarIntroShown: true }
    mockState.sidebarBody = 'agents'
    act(() => {
      root.render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)
    })

    expect(container.querySelector('[aria-label="Open full Agents view"]')).toBeNull()
  })

  it('switches to compact actions only below the wide-layout breakpoint', () => {
    mockState.sidebarWidth = 234
    act(() => {
      root.render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)
    })
    expect(container.querySelector('[aria-label="More workspace actions"]')).toBeTruthy()

    mockState.sidebarWidth = 235
    act(() => {
      root.render(<SidebarHeader onWorkspaceBoardMenuOpenChange={vi.fn()} />)
    })
    expect(container.querySelector('[aria-label="More workspace actions"]')).toBeNull()
    expect(container.querySelector('[aria-label="Add Project"]')).toBeNull()
  })
})
