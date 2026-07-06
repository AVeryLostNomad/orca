// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodeServerStatusEvent } from '../../../../shared/code-server-types'

// Enable React's act() support so the async promise-flush act() call below
// doesn't warn under happy-dom.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { ensureWebviewMock } = vi.hoisted(() => ({ ensureWebviewMock: vi.fn() }))

vi.mock('./code-server-webview', () => ({
  buildCodeServerUrl: (port: number, folder: string) =>
    `http://127.0.0.1:${port}/?folder=${folder}`,
  destroyCodeServerWebview: vi.fn(),
  ensureCodeServerWebview: ensureWebviewMock
}))

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

const storeState = {
  codeServerTabsByWorktree: {
    'wt-1': [{ id: 'tab-1', worktreeId: 'wt-1', folderPath: '/repo' }]
  },
  setCodeServerStatus: vi.fn()
}

vi.mock('../../store', () => ({
  useAppStore: (selector: (s: typeof storeState) => unknown) => selector(storeState)
}))

import CodeServerPane from './CodeServerPane'

type CodeServerApi = {
  ensureRunning: ReturnType<typeof vi.fn>
  retry: ReturnType<typeof vi.fn>
  release: ReturnType<typeof vi.fn>
  getStatus: ReturnType<typeof vi.fn>
  onStatusChanged: (cb: (e: CodeServerStatusEvent) => void) => () => void
}

describe('CodeServerPane late mount', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null
  let api: CodeServerApi

  beforeEach(() => {
    ensureWebviewMock.mockReset()
    ensureWebviewMock.mockImplementation(({ container: c }: { container: HTMLDivElement }) => ({
      webview: c.appendChild(document.createElement('div')),
      created: true
    }))
    api = {
      // Shared server already ready (another worktree started it): acquire resolves
      // with the port and NO status broadcast ever fires for this late subscriber.
      ensureRunning: vi.fn().mockResolvedValue({ port: 4321 }),
      retry: vi.fn().mockResolvedValue({ port: 4321 }),
      release: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockResolvedValue({ status: 'ready', port: 4321 }),
      onStatusChanged: () => vi.fn()
    }
    ;(window as unknown as { api: { codeServer: CodeServerApi } }).api = { codeServer: api }
  })

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  it('reaches ready from the acquire result when the server is already running', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(<CodeServerPane codeServerTabId="tab-1" worktreeId="wt-1" />)
    })
    // Flush the resolved ensureRunning promise + the ready webview effect.
    await act(async () => {
      await Promise.resolve()
    })

    expect(container.textContent).not.toContain('Starting VS Code')
    expect(ensureWebviewMock).toHaveBeenCalled()
  })
})
