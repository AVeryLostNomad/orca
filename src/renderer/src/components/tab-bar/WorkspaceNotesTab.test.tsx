import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('lucide-react', () => ({
  NotebookPen: 'NotebookPen'
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: 'Tooltip',
  TooltipTrigger: 'TooltipTrigger',
  TooltipContent: 'TooltipContent'
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

import { WorkspaceNotesTab } from './WorkspaceNotesTab'

type ReactElementLike = {
  type: unknown
  props: Record<string, unknown> & { children?: unknown }
}

function collectElements(node: unknown, out: ReactElementLike[] = []): ReactElementLike[] {
  if (node == null || typeof node === 'string' || typeof node === 'number') {
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      collectElements(child, out)
    }
    return out
  }
  const el = node as ReactElementLike
  out.push(el)
  collectElements(el.props?.children, out)
  return out
}

function renderChip(overrides: { isActive?: boolean; onActivate?: () => void } = {}): {
  elements: ReactElementLike[]
  root: ReactElementLike
  onActivate: () => void
} {
  const onActivate = overrides.onActivate ?? vi.fn()
  const tree = WorkspaceNotesTab({
    tabId: 'floating-workspace-notes',
    isActive: overrides.isActive ?? false,
    onActivate,
    includeTopTabBorder: false
  })
  const elements = collectElements(tree)
  const root = elements.find((el) => el.props['data-workspace-notes-tab'] === 'true')
  if (!root) {
    throw new Error('Missing workspace-notes chip root')
  }
  return { elements, root, onActivate }
}

describe('WorkspaceNotesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders icon-only with pinned marker and no close button', () => {
    const { elements, root } = renderChip()
    expect(root.props['data-pinned']).toBe('true')
    expect(elements.some((el) => el.type === 'NotebookPen')).toBe(true)
    expect(elements.some((el) => el.props?.['data-tab-close-button'] === 'true')).toBe(false)
  })

  it('shows the Notes tooltip', () => {
    const { elements } = renderChip()
    const tooltipContent = elements.find((el) => el.type === 'TooltipContent')
    expect(tooltipContent?.props.children).toBe('Notes')
  })

  it('activates on primary pointer down only', () => {
    const onActivate = vi.fn()
    const { root } = renderChip({ onActivate })
    const pointerDown = root.props.onPointerDown as (e: { button: number }) => void
    pointerDown({ button: 1 })
    expect(onActivate).not.toHaveBeenCalled()
    pointerDown({ button: 0 })
    expect(onActivate).toHaveBeenCalledTimes(1)
  })

  it('swallows middle-click instead of closing', () => {
    const { root } = renderChip()
    const auxClick = root.props.onAuxClick as (e: {
      preventDefault: () => void
      stopPropagation: () => void
    }) => void
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() }
    auxClick(event)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
  })

  it('marks the active state on the root', () => {
    const inactive = renderChip({ isActive: false })
    expect(inactive.root.props['aria-selected']).toBe(false)
    const active = renderChip({ isActive: true })
    expect(active.root.props['aria-selected']).toBe(true)
  })
})
