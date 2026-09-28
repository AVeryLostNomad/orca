import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@/store/slices/editor'
import type { AppState } from '@/store/types'
const { callRuntimeRpc, closeWebRuntimeSessionTab, recordWebSessionCloseIntent } = vi.hoisted(
  () => ({
    callRuntimeRpc: vi.fn(),
    closeWebRuntimeSessionTab: vi.fn(),
    recordWebSessionCloseIntent: vi.fn()
  })
)

vi.mock('@/lib/worktree-runtime-owner', () => ({
  getRuntimeEnvironmentIdForWorktree: (_state: unknown, worktreeId: string) =>
    worktreeId === 'runtime-worktree' ? 'env-1' : null
}))
vi.mock('./runtime-rpc-client', () => ({ callRuntimeRpc }))
vi.mock('./web-runtime-session', () => ({ closeWebRuntimeSessionTab }))
vi.mock('./web-session-close-intent', () => ({ recordWebSessionCloseIntent }))

import {
  adoptPublishedRuntimeEditorTab,
  markRuntimeEditorTabPublishClosed,
  publishRuntimeEditorTab,
  resetRuntimeEditorTabPublishesForTests
} from './runtime-editor-tab-publish'

function makeFile(overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    id: 'editor:runtime-worktree:env-1:/repo/src/app.ts',
    filePath: '/repo/src/app.ts',
    relativePath: 'src/app.ts',
    worktreeId: 'runtime-worktree',
    language: 'typescript',
    isDirty: false,
    runtimeEnvironmentId: 'env-1',
    mode: 'edit',
    ...overrides
  }
}

function makeState(file: OpenFile, supportsBackgroundOpen = true): AppState {
  return {
    openFiles: [file],
    runtimeStatusByEnvironmentId: new Map([
      [
        'env-1',
        {
          status: {
            capabilities: supportsBackgroundOpen ? ['files.open-background.v1'] : []
          }
        }
      ]
    ])
  } as unknown as AppState
}

describe('runtime editor tab publish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRuntimeEditorTabPublishesForTests()
    callRuntimeRpc.mockResolvedValue({})
  })

  it('publishes permanent runtime-owned edit and staged diff tabs only when supported', async () => {
    const edit = makeFile()
    publishRuntimeEditorTab(makeState(edit), edit.id)
    await vi.waitFor(() =>
      expect(callRuntimeRpc).toHaveBeenCalledWith(
        { kind: 'environment', environmentId: 'env-1' },
        'files.open',
        { worktree: 'id:runtime-worktree', relativePath: 'src/app.ts', activate: false },
        { timeoutMs: 15_000 }
      )
    )

    const diff = makeFile({
      id: 'editor-diff:runtime-worktree:env-1:staged:src/app.ts',
      mode: 'diff',
      diffSource: 'staged'
    })
    publishRuntimeEditorTab(makeState(diff), diff.id)
    await vi.waitFor(() =>
      expect(callRuntimeRpc).toHaveBeenCalledWith(
        { kind: 'environment', environmentId: 'env-1' },
        'files.openDiff',
        {
          worktree: 'id:runtime-worktree',
          relativePath: 'src/app.ts',
          staged: true,
          activate: false
        },
        { timeoutMs: 15_000 }
      )
    )
  })

  it('does not publish unsupported, local, SSH, preview, or mirrored tabs', async () => {
    const cases = [
      [makeFile(), false],
      [makeFile({ worktreeId: 'local-worktree' }), true],
      [makeFile({ externalSshTargetId: 'ssh-1' }), true],
      [makeFile({ isPreview: true }), true],
      [makeFile({ mirroredFromRuntimeSession: true }), true]
    ] as const
    for (const [file, supportsBackgroundOpen] of cases) {
      publishRuntimeEditorTab(makeState(file, supportsBackgroundOpen), file.id)
    }
    await Promise.resolve()
    expect(callRuntimeRpc).not.toHaveBeenCalled()
  })

  it('keeps a tab closed before its host echo closed, closing the host tab once', async () => {
    const file = makeFile()
    const state = makeState(file)
    publishRuntimeEditorTab(state, file.id)
    await vi.waitFor(() => expect(callRuntimeRpc).toHaveBeenCalledTimes(1))

    markRuntimeEditorTabPublishClosed(state, file)
    // Why true: the snapshot must drop the echoed tab rather than mirror a closed tab back open.
    expect(adoptPublishedRuntimeEditorTab('env-1', file, 'host-file-tab')).toBe(true)
    expect(adoptPublishedRuntimeEditorTab('env-1', file, 'host-file-tab')).toBe(false)

    await vi.waitFor(() =>
      expect(closeWebRuntimeSessionTab).toHaveBeenCalledWith({
        worktreeId: 'runtime-worktree',
        tabId: 'host-file-tab',
        environmentId: 'env-1',
        reason: 'user'
      })
    )
    expect(closeWebRuntimeSessionTab).toHaveBeenCalledTimes(1)
    expect(recordWebSessionCloseIntent).toHaveBeenCalledTimes(1)
  })
})
