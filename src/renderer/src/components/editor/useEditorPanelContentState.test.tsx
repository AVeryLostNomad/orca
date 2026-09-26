// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@/store/slices/editor'
import type { GitStatusEntry } from '../../../../shared/git-status-types'
import type { DiffContent, FileContent } from './editor-panel-content-types'

const mocks = vi.hoisted(() => ({
  readRuntimeFileContent: vi.fn(),
  getRuntimeGitDiff: vi.fn(),
  getRuntimeGitBranchDiff: vi.fn(),
  getConnectionId: vi.fn(),
  getConnectionIdForFile: vi.fn(),
  isWorktreeConnectionResolved: vi.fn(() => true),
  getState: vi.fn()
}))

const workingStateCache = vi.hoisted(() => new WeakMap<object, Record<string, unknown>>())

function getCanonicalTestState(): Record<string, unknown> {
  const base = mocks.getState() as Record<string, unknown>
  const cached = workingStateCache.get(base)
  if (cached) {
    return cached
  }
  const state = createEditorWorkingDocumentTestState(base)
  workingStateCache.set(base, state)
  return state
}

vi.mock('@/runtime/runtime-file-client', () => ({
  getRuntimeFileReadScope: vi.fn(
    (
      settings: { activeRuntimeEnvironmentId?: string | null } | null | undefined,
      connectionId?: string
    ) => connectionId ?? settings?.activeRuntimeEnvironmentId ?? null
  ),
  readRuntimeFileContent: mocks.readRuntimeFileContent,
  subscribeRuntimeFileChanges: vi.fn()
}))

vi.mock('@/runtime/runtime-git-client', () => ({
  getRuntimeGitBranchDiff: mocks.getRuntimeGitBranchDiff,
  getRuntimeGitCommitDiff: vi.fn(),
  getRuntimeGitDiff: mocks.getRuntimeGitDiff,
  getRuntimeGitScope: vi.fn(() => null)
}))

vi.mock('@/lib/connection-context', () => ({
  getConnectionId: mocks.getConnectionId,
  getConnectionIdForFile: mocks.getConnectionIdForFile,
  isWorktreeConnectionResolved: mocks.isWorktreeConnectionResolved
}))

vi.mock('@/lib/runtime-workspace-file-route', () => ({
  findWorkspaceFileRoute: vi.fn(() => null)
}))

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(getCanonicalTestState()),
    { getState: getCanonicalTestState }
  )
}))

import { useEditorPanelContentState } from './useEditorPanelContentState'
import { registerReloadGenerationTests } from './useEditorPanelContentState.reload-generation'
import { getWorkingDocumentForFile } from '@renderer/store/slices/editor/working-document-state'
import {
  createEditorWorkingDocumentTestState,
  primeEditorWorkingDocumentTestState
} from './editor-working-document-test-state'
import { getDiskBaselineSignature } from './diff-content-signature'
import { ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT } from './editor-autosave'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function dispatchExternalFileChange(file: OpenFile, worktreePath: string): void {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT, {
        detail: {
          worktreeId: file.worktreeId,
          worktreePath,
          relativePath: file.relativePath
        }
      })
    )
  })
}

type ProbeProps = {
  activeFile: OpenFile | null
  openFiles: OpenFile[]
  gitStatusByWorktree?: Record<string, GitStatusEntry[]>
}

const authorizeExternalPath = vi.fn()
// Why: opening any liveTail tab arms useLocalLogTail's change subscription.
const onLocalLogTailChanged = vi.fn(() => () => {})
const fsApi = { authorizeExternalPath, onLocalLogTailChanged }
let latestFileContents: Record<string, FileContent> = {}
let latestDiffContents: Record<string, DiffContent> = {}
let latestReloadContent: (file: OpenFile) => void = () => {}
const EMPTY_GIT_STATUS_BY_WORKTREE: Record<string, GitStatusEntry[]> = {}

function HookProbe({
  activeFile,
  openFiles,
  gitStatusByWorktree = EMPTY_GIT_STATUS_BY_WORKTREE
}: ProbeProps): null {
  primeEditorWorkingDocumentTestState(
    getCanonicalTestState(),
    openFiles,
    (worktreeId, filePath) =>
      mocks.getConnectionIdForFile(worktreeId, filePath) as string | undefined
  )
  const state = useEditorPanelContentState({
    activeFile,
    isChangesMode: false,
    openFiles,
    gitStatusEntries: activeFile ? gitStatusByWorktree[activeFile.worktreeId] : undefined,
    editorViewMode: {}
  })
  latestFileContents = state.fileContents
  latestDiffContents = state.diffContents
  latestReloadContent = state.reloadContent
  return null
}

function createOpenFile(overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    id: '/repo/file.ts',
    filePath: '/repo/file.ts',
    relativePath: 'file.ts',
    worktreeId: 'wt-1',
    language: 'typescript',
    isDirty: false,
    mode: 'edit',
    ...overrides
  }
}

describe('useEditorPanelContentState', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    latestFileContents = {}
    latestDiffContents = {}
    authorizeExternalPath.mockReset()
    authorizeExternalPath.mockResolvedValue(undefined)
    onLocalLogTailChanged.mockClear()
    ;(window as unknown as { api: unknown }).api = { fs: fsApi }
    mocks.readRuntimeFileContent.mockReset()
    mocks.getRuntimeGitDiff.mockReset()
    mocks.getRuntimeGitBranchDiff.mockReset()
    mocks.getConnectionId.mockReset()
    mocks.getConnectionId.mockReturnValue(undefined)
    mocks.getConnectionIdForFile.mockReset()
    mocks.getConnectionIdForFile.mockReturnValue(undefined)
    mocks.isWorktreeConnectionResolved.mockReset()
    mocks.isWorktreeConnectionResolved.mockReturnValue(true)
    mocks.getState.mockReset()
    mocks.getState.mockReturnValue({
      settings: null,
      openFiles: []
    })
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
    }
    container?.remove()
    container = null
    root = null
  })

  async function renderProbe(
    activeFile: OpenFile | null,
    options: {
      openFiles?: OpenFile[]
      gitStatusByWorktree?: Record<string, GitStatusEntry[]>
    } = {}
  ): Promise<void> {
    if (!container) {
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
    }
    const openFiles = options.openFiles ?? (activeFile ? [activeFile] : [])
    await act(async () => {
      root?.render(
        <HookProbe
          activeFile={activeFile}
          openFiles={openFiles}
          gitStatusByWorktree={options.gitStatusByWorktree}
        />
      )
    })
  }

  it('loads folder workspace files through the path-specific SSH connection', async () => {
    const activeFile = createOpenFile({
      filePath: '/home/neil/platform/api/src/file.ts',
      relativePath: 'api/src/file.ts',
      worktreeId: 'folder:folder-workspace-1'
    })
    mocks.getConnectionIdForFile.mockReturnValue('ssh-1')
    mocks.readRuntimeFileContent.mockResolvedValue({ content: 'remote content', isBinary: false })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    })

    await vi.waitFor(() =>
      expect(latestFileContents[activeFile.id]?.content).toBe('remote content')
    )
    expect(mocks.getConnectionIdForFile).toHaveBeenCalledWith(
      'folder:folder-workspace-1',
      '/home/neil/platform/api/src/file.ts'
    )
    expect(mocks.readRuntimeFileContent).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/home/neil/platform/api/src/file.ts',
        relativePath: 'api/src/file.ts',
        worktreeId: 'folder:folder-workspace-1',
        connectionId: 'ssh-1'
      })
    )
  })

  it('loads an external SSH-host image when the tab is pinned to that target', async () => {
    const activeFile = createOpenFile({
      id: '/tmp/ssh-preview.png',
      filePath: '/tmp/ssh-preview.png',
      relativePath: '/tmp/ssh-preview.png',
      worktreeId: 'repo-ssh::/home/user/project',
      externalSshTargetId: 'ssh-1'
    } as never)
    mocks.getConnectionIdForFile.mockReturnValue('ssh-1')
    mocks.readRuntimeFileContent.mockResolvedValue({
      content: 'base64-image',
      isBinary: true,
      isImage: true,
      mimeType: 'image/png'
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    })

    await vi.waitFor(() => expect(latestFileContents[activeFile.id]?.isImage).toBe(true))
    expect(mocks.readRuntimeFileContent).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/tmp/ssh-preview.png',
        relativePath: '/tmp/ssh-preview.png',
        worktreeId: 'repo-ssh::/home/user/project',
        connectionId: 'ssh-1',
        expectedExternalSshTargetId: 'ssh-1'
      })
    )
  })

  it('loads an unstamped external SSH-host tab through the resolved connection', async () => {
    const activeFile = createOpenFile({
      id: '/work/reports/audit.md',
      filePath: '/work/reports/audit.md',
      relativePath: '/work/reports/audit.md',
      worktreeId: 'repo-ssh::/work/demo-project'
    })
    mocks.getConnectionIdForFile.mockReturnValue('ssh-1')
    mocks.readRuntimeFileContent.mockResolvedValue({ content: '# remote', isBinary: false })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    })

    await vi.waitFor(() => expect(latestFileContents[activeFile.id]?.content).toBe('# remote'))
    // Why: the client-local grant must not be requested for a remote-owned path.
    expect(authorizeExternalPath).not.toHaveBeenCalled()
    expect(mocks.readRuntimeFileContent).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/work/reports/audit.md',
        connectionId: 'ssh-1',
        expectedExternalSshTargetId: undefined
      })
    )
  })

  it('keeps a client-local live-tail log tab on the client inside an SSH workspace', async () => {
    const logPath = '/Users/me/.codex/sessions/session.jsonl'
    const worktreeId = 'repo-ssh::/work/demo-project'
    const externalTab = { id: logPath, filePath: logPath, relativePath: logPath, worktreeId }
    const activeFile = createOpenFile({ ...externalTab, readOnly: true, liveTail: true })
    mocks.getConnectionIdForFile.mockReturnValue('ssh-1')
    mocks.readRuntimeFileContent.mockResolvedValue({ content: 'log line', isBinary: false })

    container = document.body.appendChild(document.createElement('div'))
    root = createRoot(container)

    await act(async () => {
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    })

    await vi.waitFor(() => expect(latestFileContents[activeFile.id]?.content).toBe('log line'))
    // Why: AI Vault only surfaces client-local logs, so the worktree's SSH target must
    // not capture this read — it stays a granted client-local path.
    expect(authorizeExternalPath).toHaveBeenCalledWith({ targetPath: logPath })
    expect(mocks.readRuntimeFileContent).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: undefined, includeLocalLogMetadata: true })
    )
  })

  it('re-authorizes a client-local external tab before reading it', async () => {
    const activeFile = createOpenFile({
      id: '/Users/me/notes/audit.md',
      filePath: '/Users/me/notes/audit.md',
      relativePath: '/Users/me/notes/audit.md',
      worktreeId: 'repo-local::/Users/me/project'
    })
    mocks.getConnectionIdForFile.mockReturnValue(undefined)
    mocks.readRuntimeFileContent.mockResolvedValue({ content: '# local', isBinary: false })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    })

    await vi.waitFor(() => expect(latestFileContents[activeFile.id]?.content).toBe('# local'))
    expect(authorizeExternalPath).toHaveBeenCalledWith({ targetPath: '/Users/me/notes/audit.md' })
  })

  it('rejects an unstamped external tab in a remote runtime workspace', async () => {
    const activeFile = createOpenFile({
      id: '/work/reports/audit.md',
      filePath: '/work/reports/audit.md',
      relativePath: '/work/reports/audit.md',
      worktreeId: 'repo-runtime::/work/demo-project'
    })
    mocks.getState.mockReturnValue({
      settings: { activeRuntimeEnvironmentId: 'runtime-1' },
      openFiles: []
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    })

    await vi.waitFor(() =>
      expect(latestFileContents[activeFile.id]?.loadError).toBe(
        'External local files are not available for remote workspaces.'
      )
    )
    expect(mocks.readRuntimeFileContent).not.toHaveBeenCalled()
  })

  it('rejects an external SSH-host tab after its target owner changes', async () => {
    const activeFile = createOpenFile({
      id: '/tmp/ssh-preview.png',
      filePath: '/tmp/ssh-preview.png',
      relativePath: '/tmp/ssh-preview.png',
      worktreeId: 'repo-ssh::/home/user/project',
      externalSshTargetId: 'ssh-original'
    } as never)
    mocks.getConnectionIdForFile.mockReturnValue('ssh-replacement')
    mocks.readRuntimeFileContent.mockRejectedValue(
      new Error('External SSH files are not available after the workspace host changes.')
    )

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    })

    await vi.waitFor(() =>
      expect(latestFileContents[activeFile.id]?.loadError).toBe(
        'External SSH files are not available after the workspace host changes.'
      )
    )
    expect(mocks.readRuntimeFileContent).not.toHaveBeenCalled()
  })

  it('loads folder workspace branch diffs through the path-specific SSH connection', async () => {
    const activeFile = createOpenFile({
      id: 'branch-diff',
      filePath: '/home/neil/platform/api/src/file.ts',
      relativePath: 'api/src/file.ts',
      worktreeId: 'folder:folder-workspace-1',
      mode: 'diff',
      diffSource: 'branch',
      branchCompare: {
        baseRef: 'main',
        compareRef: 'feature',
        compareVersion: 'feature',
        baseOid: 'base',
        headOid: 'head',
        mergeBase: 'merge-base'
      }
    })
    mocks.getConnectionIdForFile.mockReturnValue('ssh-1')
    mocks.getRuntimeGitBranchDiff.mockResolvedValue({
      kind: 'text',
      originalContent: 'old',
      modifiedContent: 'remote branch diff',
      originalIsBinary: false,
      modifiedIsBinary: false
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    })

    await vi.waitFor(() =>
      expect(latestDiffContents[activeFile.id]).toMatchObject({
        modifiedContent: 'remote branch diff'
      })
    )
    expect(mocks.getConnectionIdForFile).toHaveBeenCalledWith(
      'folder:folder-workspace-1',
      '/home/neil/platform/api/src/file.ts'
    )
    expect(mocks.getRuntimeGitBranchDiff).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeId: 'folder:folder-workspace-1',
        worktreePath: '/home/neil/platform',
        connectionId: 'ssh-1'
      }),
      expect.objectContaining({
        compare: expect.objectContaining({ headOid: 'head', mergeBase: 'merge-base' }),
        filePath: 'api/src/file.ts'
      })
    )
  })

  it('does not read locally while a remote host worktree owner is still hydrating (#6648)', async () => {
    const activeFile = createOpenFile({
      filePath: '/home/user/project/src/index.ts',
      relativePath: 'src/index.ts',
      worktreeId: 'repo-ssh::/home/user/project'
    })
    // Owner unknown (SSH repo not hydrated): connection unresolved + not ready.
    mocks.getConnectionIdForFile.mockReturnValue(undefined)
    mocks.isWorktreeConnectionResolved.mockReturnValue(false)

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    })

    // Surfaces a retryable owner-not-ready error instead of a terminal local
    // "access denied", and never attempts the bad local read.
    await vi.waitFor(() => expect(latestFileContents[activeFile.id]?.loadError).toBeTruthy())
    expect(latestFileContents[activeFile.id]?.loadError).not.toMatch(/access denied/i)
    expect(mocks.readRuntimeFileContent).not.toHaveBeenCalled()

    // The SSH repo finishes hydrating: the worktree owner resolves to its
    // target. We do NOT bump the reload nonce here — the retry hook must
    // re-attempt the read on its own once the owner-not-ready error clears.
    mocks.isWorktreeConnectionResolved.mockReturnValue(true)
    mocks.getConnectionIdForFile.mockReturnValue('ssh-target-1')
    mocks.readRuntimeFileContent.mockResolvedValue({ content: 'remote', isBinary: false })
    primeEditorWorkingDocumentTestState(
      getCanonicalTestState(),
      [activeFile],
      (worktreeId, filePath) =>
        mocks.getConnectionIdForFile(worktreeId, filePath) as string | undefined
    )

    // Driven purely by the automatic retry (no re-render, no forced reload).
    await vi.waitFor(() => expect(latestFileContents[activeFile.id]?.content).toBe('remote'), {
      timeout: 3000
    })
    expect(mocks.readRuntimeFileContent).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/home/user/project/src/index.ts',
        worktreeId: 'repo-ssh::/home/user/project',
        connectionId: 'ssh-target-1'
      })
    )
  })

  it('reloads a clean file when its file content reload nonce changes', async () => {
    const activeFile = createOpenFile()
    mocks.readRuntimeFileContent
      .mockResolvedValueOnce({ content: 'old content', isBinary: false })
      .mockResolvedValueOnce({ content: 'fresh content', isBinary: false })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    })

    await vi.waitFor(() => expect(latestFileContents[activeFile.id]?.content).toBe('old content'))

    const reloadedFile = { ...activeFile, fileContentReloadNonce: 1 }
    await act(async () => {
      root?.render(<HookProbe activeFile={reloadedFile} openFiles={[reloadedFile]} />)
    })

    await vi.waitFor(() => expect(latestFileContents[activeFile.id]?.content).toBe('fresh content'))
    expect(mocks.readRuntimeFileContent).toHaveBeenCalledTimes(2)
    expect(mocks.readRuntimeFileContent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filePath: '/repo/file.ts',
        relativePath: 'file.ts',
        worktreeId: 'wt-1'
      })
    )
  })

  it('keeps a loaded unstaged diff when git status moves the row to staged', async () => {
    const activeFile = createOpenFile({
      id: 'wt-1::diff::unstaged::file.ts',
      mode: 'diff',
      diffSource: 'unstaged'
    })
    mocks.getRuntimeGitDiff.mockResolvedValue({
      kind: 'text',
      originalContent: 'old',
      modifiedContent: 'large diff content',
      originalIsBinary: false,
      modifiedIsBinary: false
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <HookProbe
          activeFile={activeFile}
          openFiles={[activeFile]}
          gitStatusByWorktree={{
            'wt-1': [{ path: 'file.ts', status: 'modified', area: 'unstaged' }]
          }}
        />
      )
    })

    await vi.waitFor(() =>
      expect(latestDiffContents[activeFile.id]).toMatchObject({
        modifiedContent: 'large diff content'
      })
    )

    await act(async () => {
      root?.render(
        <HookProbe
          activeFile={activeFile}
          openFiles={[activeFile]}
          gitStatusByWorktree={{
            'wt-1': [{ path: 'file.ts', status: 'modified', area: 'staged' }]
          }}
        />
      )
    })

    expect(mocks.getRuntimeGitDiff).toHaveBeenCalledTimes(1)
  })

  it('reloads a loaded unstaged diff when its own status row is still present', async () => {
    const activeFile = createOpenFile({
      id: 'wt-1::diff::unstaged::file.ts',
      mode: 'diff',
      diffSource: 'unstaged'
    })
    mocks.getRuntimeGitDiff
      .mockResolvedValueOnce({
        kind: 'text',
        originalContent: 'old',
        modifiedContent: 'first diff content',
        originalIsBinary: false,
        modifiedIsBinary: false
      })
      .mockResolvedValueOnce({
        kind: 'text',
        originalContent: 'old',
        modifiedContent: 'refreshed diff content',
        originalIsBinary: false,
        modifiedIsBinary: false
      })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    })

    await vi.waitFor(() =>
      expect(latestDiffContents[activeFile.id]).toMatchObject({
        modifiedContent: 'first diff content'
      })
    )

    await act(async () => {
      root?.render(
        <HookProbe
          activeFile={activeFile}
          openFiles={[activeFile]}
          gitStatusByWorktree={{
            'wt-1': [{ path: 'file.ts', status: 'modified', area: 'unstaged' }]
          }}
        />
      )
    })

    await vi.waitFor(() =>
      expect(latestDiffContents[activeFile.id]).toMatchObject({
        modifiedContent: 'refreshed diff content'
      })
    )
    expect(mocks.getRuntimeGitDiff).toHaveBeenCalledTimes(2)
  })

  registerReloadGenerationTests({
    createDeferred,
    createOpenFile,
    dispatchExternalFileChange,
    fileContents: () => latestFileContents,
    diffContents: () => latestDiffContents,
    mocks: {
      getRuntimeGitDiff: mocks.getRuntimeGitDiff,
      readRuntimeFileContent: mocks.readRuntimeFileContent
    },
    reloadContent: (file) => latestReloadContent(file),
    renderProbe
  })

  it('stamps the disk baseline when a clean tab load resolves', async () => {
    const activeFile = createOpenFile()
    mocks.getState.mockReturnValue({
      settings: null,
      openFiles: [activeFile]
    })
    mocks.readRuntimeFileContent.mockResolvedValue({ content: 'disk content', isBinary: false })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    })

    await vi.waitFor(() =>
      expect(
        getWorkingDocumentForFile(getCanonicalTestState() as never, activeFile.id)
          ?.lastKnownDiskSignature
      ).toBe(getDiskBaselineSignature('disk content'))
    )
  })

  it('refreshes a registered editor HEAD baseline without replacing dirty content', async () => {
    const activeFile = createOpenFile({ isDirty: true })
    const worktree = { id: 'wt-1', repoId: 'repo-1', path: '/repo', head: 'first-head' }
    const state = {
      settings: null,
      repos: [{ id: 'repo-1', kind: 'git' }],
      worktreesByRepo: { 'repo-1': [worktree] },
      openFiles: [activeFile]
    }
    mocks.getState.mockReturnValue(state)
    mocks.readRuntimeFileContent.mockResolvedValue({ content: 'working content', isBinary: false })
    mocks.getRuntimeGitDiff.mockImplementation(async () => ({
      kind: 'text',
      originalContent: worktree.head,
      modifiedContent: 'working content',
      originalIsBinary: false,
      modifiedIsBinary: false,
      originalReadState: 'present',
      modifiedReadState: 'present'
    }))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () =>
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    )
    await vi.waitFor(() =>
      expect(latestDiffContents[activeFile.id]).toMatchObject({ originalContent: 'first-head' })
    )
    worktree.head = 'second-head'
    await act(async () =>
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    )
    await vi.waitFor(() =>
      expect(latestDiffContents[activeFile.id]).toMatchObject({ originalContent: 'second-head' })
    )
    expect(mocks.readRuntimeFileContent).toHaveBeenCalledTimes(1)
    expect(latestFileContents[activeFile.id]?.content).toBe('working content')
  })

  it('reports a diff read error without manufacturing file content and retries', async () => {
    const activeFile = createOpenFile({ mode: 'diff', diffSource: 'unstaged' })
    mocks.getRuntimeGitDiff
      .mockRejectedValueOnce(new Error('Permission denied'))
      .mockResolvedValueOnce({
        kind: 'text',
        originalContent: 'before',
        modifiedContent: 'after',
        originalIsBinary: false,
        modifiedIsBinary: false
      })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () =>
      root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
    )
    await vi.waitFor(() =>
      expect(latestDiffContents[activeFile.id]).toEqual({
        kind: 'error',
        message: 'Error: Permission denied'
      })
    )
    await act(async () => latestReloadContent(activeFile))
    await vi.waitFor(() =>
      expect(latestDiffContents[activeFile.id]).toMatchObject({
        kind: 'text',
        modifiedContent: 'after'
      })
    )
  })
  it.each(['folder', 'binary', 'external', 'untitled'] as const)(
    'does not acquire Git baselines for %s editors',
    async (scenario) => {
      const activeFile = createOpenFile({
        ...(scenario === 'external' ? { relativePath: '/repo/file.ts' } : {}),
        ...(scenario === 'untitled' ? { isUntitled: true } : {})
      })
      mocks.getState.mockReturnValue({
        settings: null,
        repos: [{ id: 'repo-1', kind: scenario === 'folder' ? 'folder' : 'git' }],
        worktreesByRepo: {
          'repo-1': [{ id: 'wt-1', repoId: 'repo-1', path: '/repo', head: 'head' }]
        },
        openFiles: [activeFile]
      })
      mocks.readRuntimeFileContent.mockResolvedValue({
        content: 'data',
        isBinary: scenario === 'binary'
      })
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
      await act(async () =>
        root?.render(<HookProbe activeFile={activeFile} openFiles={[activeFile]} />)
      )
      await vi.waitFor(() => expect(latestFileContents[activeFile.id]?.content).toBe('data'))
      expect(mocks.getRuntimeGitDiff).not.toHaveBeenCalled()
    }
  )
})
