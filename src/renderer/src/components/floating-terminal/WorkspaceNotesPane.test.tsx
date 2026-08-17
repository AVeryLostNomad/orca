import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import { ORCA_EDITOR_SAVE_AND_CLOSE_EVENT } from '@/components/editor/editor-autosave'

const hookRuntime = vi.hoisted(() => ({
  effects: [] as (() => void)[],
  index: 0,
  values: [] as unknown[]
}))

const storeMock = vi.hoisted(() => ({
  state: {} as Record<string, unknown>
}))

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react') // eslint-disable-line @typescript-eslint/consistent-type-imports -- vi.importActual requires inline import()
  return {
    ...actual,
    useEffect: (effect: () => void) => {
      hookRuntime.effects.push(effect)
    },
    useRef: <T,>(initialValue: T) => {
      const index = hookRuntime.index++
      if (hookRuntime.values[index] === undefined) {
        hookRuntime.values[index] = { current: initialValue }
      }
      return hookRuntime.values[index] as { current: T }
    },
    useState: <T,>(initialValue: T) => {
      const index = hookRuntime.index++
      if (hookRuntime.values[index] === undefined) {
        hookRuntime.values[index] = initialValue
      }
      const setValue = (next: T): void => {
        hookRuntime.values[index] = next
      }
      return [hookRuntime.values[index] as T, setValue] as const
    }
  }
})

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(storeMock.state),
    { getState: () => storeMock.state }
  )
}))

vi.mock('@/lib/lazy-with-retry', () => ({
  lazyWithRetry: () =>
    function EditorPanel() {
      return null
    }
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

import { WorkspaceNotesPane } from './WorkspaceNotesPane'

type ReactElementLike = {
  type: unknown
  props: Record<string, unknown> & { children?: unknown }
}

function collectText(node: unknown, out: string[] = []): string[] {
  if (node == null) {
    return out
  }
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      collectText(child, out)
    }
    return out
  }
  collectText((node as ReactElementLike).props?.children, out)
  return out
}

function findEditorPanel(node: unknown): ReactElementLike | null {
  if (node == null || typeof node === 'string' || typeof node === 'number') {
    return null
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findEditorPanel(child)
      if (found) {
        return found
      }
    }
    return null
  }
  const el = node as ReactElementLike
  const typeName =
    typeof el.type === 'function' ? (el.type as { name?: string }).name : String(el.type)
  if (typeName === 'EditorPanel') {
    return el
  }
  return findEditorPanel(el.props?.children)
}

function render(): unknown {
  hookRuntime.index = 0
  return WorkspaceNotesPane({ open: true })
}

async function renderAndRunEffects(): Promise<unknown> {
  const element = render()
  for (const effect of hookRuntime.effects.splice(0)) {
    effect()
  }
  await Promise.resolve()
  await Promise.resolve()
  return element
}

describe('WorkspaceNotesPane', () => {
  const ensureWorkspaceNotesFile = vi.fn()
  const openFile = vi.fn()
  const dispatchedEvents: CustomEvent[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    hookRuntime.effects = []
    hookRuntime.index = 0
    hookRuntime.values = []
    dispatchedEvents.length = 0
    storeMock.state = {
      activeWorktreeId: null,
      openFiles: [],
      openFile,
      worktreesByRepo: {
        'repo-1': [{ id: 'repo-1::/tmp/wt-a', displayName: 'My Feature' }]
      },
      folderWorkspaces: []
    }
    vi.stubGlobal('window', {
      dispatchEvent: (event: Event) => {
        dispatchedEvents.push(event as CustomEvent)
        return true
      },
      api: { app: { ensureWorkspaceNotesFile } }
    })
    ensureWorkspaceNotesFile.mockResolvedValue({
      filePath: '/user-data/workspace-notes/x/notes.md'
    })
    openFile.mockReturnValue('/user-data/workspace-notes/x/notes.md')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the placeholder and creates nothing when no workspace is selected', async () => {
    const element = await renderAndRunEffects()
    expect(collectText(element).join('')).toContain('Click on a workspace to see workspace notes')
    expect(ensureWorkspaceNotesFile).not.toHaveBeenCalled()
    expect(openFile).not.toHaveBeenCalled()
  })

  it('treats the floating sentinel as no selection', async () => {
    storeMock.state.activeWorktreeId = FLOATING_TERMINAL_WORKTREE_ID
    const element = await renderAndRunEffects()
    expect(collectText(element).join('')).toContain('Click on a workspace to see workspace notes')
    expect(ensureWorkspaceNotesFile).not.toHaveBeenCalled()
  })

  it('ensures and opens the selected workspace notes as a tab-less always-autosave file', async () => {
    storeMock.state.activeWorktreeId = 'repo-1::/tmp/wt-a'
    await renderAndRunEffects()

    expect(ensureWorkspaceNotesFile).toHaveBeenCalledWith({
      workspaceId: 'repo-1::/tmp/wt-a',
      displayName: 'My Feature'
    })
    expect(openFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/user-data/workspace-notes/x/notes.md',
        worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
        mode: 'edit',
        language: 'markdown',
        alwaysAutoSave: true,
        workspaceNotesOwnerId: 'repo-1::/tmp/wt-a'
      }),
      expect.objectContaining({ suppressUnifiedTab: true, suppressActiveRuntimeFallback: true })
    )

    const element = await renderAndRunEffects()
    const editorPanel = findEditorPanel(element)
    expect(editorPanel?.props.activeFileId).toBe('/user-data/workspace-notes/x/notes.md')
  })

  it('flush-closes notes owned by other workspaces before opening the next', async () => {
    storeMock.state.activeWorktreeId = 'repo-1::/tmp/wt-a'
    storeMock.state.openFiles = [
      {
        id: 'stale-notes',
        worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
        workspaceNotesOwnerId: 'repo-1::/tmp/wt-old'
      },
      { id: 'ordinary-file', worktreeId: FLOATING_TERMINAL_WORKTREE_ID }
    ]
    await renderAndRunEffects()

    const saveAndCloseIds = dispatchedEvents
      .filter((event) => event.type === ORCA_EDITOR_SAVE_AND_CLOSE_EVENT)
      .map((event) => (event.detail as { fileId: string }).fileId)
    expect(saveAndCloseIds).toEqual(['stale-notes'])
  })

  it('shows the unavailable message when the ensure API is missing (web client)', async () => {
    storeMock.state.activeWorktreeId = 'repo-1::/tmp/wt-a'
    vi.stubGlobal('window', { dispatchEvent: () => true, api: { app: {} } })
    const first = await renderAndRunEffects()
    void first
    const element = render()
    expect(collectText(element).join('')).toContain(
      'Workspace notes are unavailable in this client.'
    )
  })
})
