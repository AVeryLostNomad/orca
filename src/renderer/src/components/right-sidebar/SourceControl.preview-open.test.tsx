// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { within } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import type {
  GitBranchChangeEntry,
  GitBranchCompareSummary
} from '../../../../shared/git-diff-compare-types'
import type { GitStatusEntry } from '../../../../shared/git-status-types'
import SourceControl from './SourceControl'

const mocks = vi.hoisted(() => {
  const activeRepo = {
    id: 'repo-1',
    path: '/repo',
    displayName: 'Repo',
    badgeColor: '#000',
    addedAt: 0,
    executionHostId: 'local' as const
  }
  const activeWorktree = {
    id: 'wt-1',
    repoId: 'repo-1',
    path: '/repo/wt',
    head: 'abcdef123',
    branch: 'refs/heads/feature/source-control-preview',
    isBare: false,
    isMainWorktree: false,
    displayName: 'feature/source-control-preview',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    linkedGitLabMR: null,
    linkedGitLabIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    hostId: 'local' as const
  }
  const calls = {
    openDiff: vi.fn(),
    openFile: vi.fn(),
    openConflictFile: vi.fn(),
    openBranchDiff: vi.fn(),
    createEmptySplitGroup: vi.fn(),
    discardRuntimeGitPath: vi.fn(),
    bulkStageRuntimeGitPaths: vi.fn(),
    refreshGitStatusForWorktree: vi.fn(),
    quiesceDocumentSave: vi.fn(),
    notifyEditorExternalFileChange: vi.fn(),
    statRuntimePath: vi.fn()
  }
  return {
    activeRepo,
    activeWorktree,
    calls,
    state: {} as Record<string, unknown>
  }
})

vi.mock('@/store', () => {
  const useAppStore = Object.assign(
    (selector?: (state: Record<string, unknown>) => unknown) =>
      selector ? selector(mocks.state) : mocks.state,
    {
      getState: () => mocks.state
    }
  )
  return { useAppStore }
})

vi.mock('@/store/selectors', () => ({
  useActiveWorktree: () => mocks.activeWorktree,
  useRepoById: (repoId: string | null) =>
    repoId === mocks.activeRepo.id ? mocks.activeRepo : null,
  useWorktreeMap: () => new Map([[mocks.activeWorktree.id, mocks.activeWorktree]])
}))

vi.mock('@/components/confirmation-dialog-context', () => ({
  useConfirmationDialog: () => vi.fn().mockResolvedValue(true)
}))

vi.mock('@/runtime/runtime-git-client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    discardRuntimeGitPath: mocks.calls.discardRuntimeGitPath,
    bulkStageRuntimeGitPaths: mocks.calls.bulkStageRuntimeGitPaths
  }
})

vi.mock('@/runtime/runtime-file-metadata-client', () => ({
  statRuntimePath: mocks.calls.statRuntimePath
}))

vi.mock('@/components/editor/editor-autosave', () => ({
  quiesceDocumentSave: mocks.calls.quiesceDocumentSave,
  notifyEditorExternalFileChange: mocks.calls.notifyEditorExternalFileChange
}))

vi.mock('./git-status-refresh', () => ({
  refreshGitStatusForWorktree: mocks.calls.refreshGitStatusForWorktree
}))

function gitEntry(overrides: Partial<GitStatusEntry>): GitStatusEntry {
  return {
    path: 'src/file.ts',
    area: 'unstaged',
    status: 'modified',
    added: 1,
    removed: 0,
    ...overrides
  }
}

function branchEntry(overrides: Partial<GitBranchChangeEntry> = {}): GitBranchChangeEntry {
  return {
    path: 'src/branch.ts',
    status: 'modified',
    added: 2,
    removed: 1,
    ...overrides
  }
}

function branchSummary(): GitBranchCompareSummary {
  return {
    baseRef: 'origin/main',
    baseOid: 'base',
    compareRef: 'feature/source-control-preview',
    headOid: 'head',
    mergeBase: 'base',
    changedFiles: 1,
    commitsAhead: 1,
    status: 'ready'
  }
}

function noopAsync(value: unknown = undefined): () => Promise<unknown> {
  return vi.fn().mockResolvedValue(value)
}

function resetState(overrides: Partial<Record<string, unknown>> = {}): void {
  vi.clearAllMocks()
  mocks.calls.createEmptySplitGroup.mockImplementation((worktreeId: string) => {
    const activeGroupIdByWorktree = mocks.state.activeGroupIdByWorktree as Record<string, string>
    activeGroupIdByWorktree[worktreeId] = 'group-2'
    return 'group-2'
  })
  mocks.calls.openFile.mockReturnValue('file-1')
  mocks.calls.discardRuntimeGitPath.mockResolvedValue(undefined)
  mocks.calls.bulkStageRuntimeGitPaths.mockResolvedValue(undefined)
  mocks.calls.refreshGitStatusForWorktree.mockResolvedValue(undefined)
  mocks.calls.quiesceDocumentSave.mockResolvedValue(undefined)
  mocks.calls.statRuntimePath.mockResolvedValue({ size: 1, isDirectory: false, mtime: 1 })
  mocks.state = {
    workingDocuments: {},
    activeWorktreeId: mocks.activeWorktree.id,
    activeGroupIdByWorktree: { [mocks.activeWorktree.id]: 'group-1' },
    groupsByWorktree: { [mocks.activeWorktree.id]: [{ id: 'group-1', activeTabId: null }] },
    repos: [mocks.activeRepo],
    worktreesByRepo: { [mocks.activeRepo.id]: [mocks.activeWorktree] },
    rightSidebarOpen: false,
    rightSidebarTab: 'source-control',
    gitStatusByWorktree: { [mocks.activeWorktree.id]: [] },
    gitBranchChangesByWorktree: { [mocks.activeWorktree.id]: [] },
    gitBranchCompareSummaryByWorktree: { [mocks.activeWorktree.id]: null },
    gitBranchLineTotalByWorktree: {},
    gitConflictOperationByWorktree: {},
    remoteStatusesByWorktree: {},
    isRemoteOperationActive: false,
    inFlightRemoteOpKind: null,
    settings: null,
    detectedWorktreesByRepo: {},
    folderWorkspaces: [],
    projectGroups: [],
    restoredRuntimeHostIdByWorkspaceSessionKey: {},
    runtimeEnvironments: [],
    runtimeEnvironmentCatalogHydrated: true,
    removedRuntimeEnvironmentIds: new Set(),
    sshConnectionStates: {},
    sshStateByEnvironment: {},
    hostedReviewCache: {},
    prCache: {},
    commitMessageGenerationRecords: {},
    pullRequestGenerationRecords: {},
    getDiffComments: vi.fn(() => []),
    updateSettings: noopAsync(),
    openSettingsTarget: vi.fn(),
    openSettingsPage: vi.fn(),
    fetchHostedReviewForBranch: noopAsync(),
    getHostedReviewCreationEligibility: noopAsync(null),
    createHostedReview: noopAsync({ ok: false, error: 'not available' }),
    updateWorktreeMeta: noopAsync(),
    fetchPRForBranch: noopAsync(),
    enqueueGitHubPRRefresh: vi.fn(),
    updateRepo: noopAsync(),
    setGitStatus: vi.fn(),
    updateWorktreeGitIdentity: vi.fn(),
    beginGitBranchCompareRequest: vi.fn(() => 'request-key'),
    setGitBranchCompareResult: vi.fn(),
    clearGitBranchCompare: vi.fn(),
    fetchUpstreamStatus: noopAsync(),
    setUpstreamStatus: vi.fn(),
    pushBranch: noopAsync(),
    pullBranch: noopAsync(),
    fastForwardBranch: noopAsync(),
    syncBranch: noopAsync(),
    rebaseFromBase: noopAsync(),
    fetchBranch: noopAsync(),
    revealInExplorer: vi.fn(),
    trackConflictPath: vi.fn(),
    openDiff: mocks.calls.openDiff,
    openFile: mocks.calls.openFile,
    setEditorViewMode: vi.fn(),
    setMarkdownViewMode: vi.fn(),
    setPendingEditorReveal: vi.fn(),
    openConflictFile: mocks.calls.openConflictFile,
    openConflictReview: vi.fn(),
    openBranchDiff: mocks.calls.openBranchDiff,
    createEmptySplitGroup: mocks.calls.createEmptySplitGroup,
    openAllDiffs: vi.fn(),
    openBranchAllDiffs: vi.fn(),
    openCommitAllDiffs: vi.fn(),
    deleteDiffComment: noopAsync(true),
    clearDiffComments: noopAsync(true),
    clearDiffCommentsForFile: noopAsync(true),
    setScrollToDiffCommentId: vi.fn(),
    setRightSidebarOpen: vi.fn(),
    setRightSidebarTab: vi.fn(),
    allocateCommitMessageGenerationRequestId: vi.fn(() => 'commit-generation-1'),
    setCommitMessageGenerationRecord: vi.fn(),
    updateCommitMessageGenerationRecord: vi.fn(),
    pruneCommitMessageGenerationRecords: vi.fn(),
    allocatePullRequestGenerationRequestId: vi.fn(() => 'pr-generation-1'),
    setPullRequestGenerationRecord: vi.fn(),
    updatePullRequestGenerationRecord: vi.fn(),
    prunePullRequestGenerationRecords: vi.fn(),
    ...overrides
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  resetState()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderSourceControl(): void {
  act(() => {
    root.render(
      <TooltipProvider>
        <SourceControl />
      </TooltipProvider>
    )
  })
}

function clickUncommitted(path: string, init: MouseEventInit = {}): void {
  const row = container.querySelector<HTMLDivElement>(`[data-source-control-path="${path}"]`)
  expect(row).not.toBeNull()
  act(() => {
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, ...init }))
  })
}
async function doubleClickUncommitted(path: string, init: MouseEventInit = {}): Promise<void> {
  const row = container.querySelector<HTMLDivElement>(`[data-source-control-path="${path}"]`)
  expect(row).not.toBeNull()
  await act(async () => {
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, ...init }))
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2, ...init }))
    row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2, ...init }))
    await Promise.resolve()
  })
}

function clickBranchRow(init: MouseEventInit = {}): void {
  const label = [...container.querySelectorAll('span')].find(
    (candidate) => candidate.textContent === 'branch.ts'
  )
  const row = label?.closest('div')
  if (!row) {
    throw new Error('Branch file row is not visible')
  }
  act(() => {
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, ...init }))
  })
}

async function doubleClickBranchRow(): Promise<void> {
  const label = [...container.querySelectorAll('span')].find(
    (candidate) => candidate.textContent === 'branch.ts'
  )
  const row = label?.closest('div')
  if (!row) {
    throw new Error('Branch file row is not visible')
  }
  await act(async () => {
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
    row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }))
    await Promise.resolve()
  })
}

describe('SourceControl preview row opens', () => {
  it('passes preview=true when plain uncommitted row clicks open diff tabs', () => {
    resetState({
      gitStatusByWorktree: {
        [mocks.activeWorktree.id]: [
          gitEntry({ path: 'src/file.ts' }),
          gitEntry({ path: 'src/staged.ts', area: 'staged' })
        ]
      }
    })
    renderSourceControl()

    clickUncommitted('src/file.ts')
    clickUncommitted('src/staged.ts')

    expect(mocks.calls.openDiff).toHaveBeenCalledWith(
      mocks.activeWorktree.id,
      '/repo/wt/src/file.ts',
      'src/file.ts',
      'typescript',
      false,
      { targetGroupId: undefined, preview: true }
    )
    expect(mocks.calls.openDiff).toHaveBeenCalledWith(
      mocks.activeWorktree.id,
      '/repo/wt/src/staged.ts',
      'src/staged.ts',
      'typescript',
      true,
      { targetGroupId: undefined, preview: true }
    )
  })

  it('keeps modifier split row opens permanent and targeted at the split group', () => {
    resetState({
      gitStatusByWorktree: { [mocks.activeWorktree.id]: [gitEntry({ path: 'src/file.ts' })] }
    })
    renderSourceControl()

    clickUncommitted('src/file.ts', { ctrlKey: true })

    expect(mocks.calls.createEmptySplitGroup).toHaveBeenCalledWith(
      mocks.activeWorktree.id,
      'group-1',
      'right'
    )
    expect(mocks.calls.openDiff).toHaveBeenCalledWith(
      mocks.activeWorktree.id,
      '/repo/wt/src/file.ts',
      'src/file.ts',
      'typescript',
      false,
      { targetGroupId: 'group-2', preview: false }
    )
  })

  it('opens a preview diff on the first click and the current working file on double-click', async () => {
    resetState({
      gitStatusByWorktree: { [mocks.activeWorktree.id]: [gitEntry({ path: 'src/file.ts' })] }
    })
    renderSourceControl()

    await doubleClickUncommitted('src/file.ts')

    expect(mocks.calls.openDiff).toHaveBeenCalledTimes(1)
    expect(mocks.calls.openDiff).toHaveBeenCalledWith(
      mocks.activeWorktree.id,
      '/repo/wt/src/file.ts',
      'src/file.ts',
      'typescript',
      false,
      { targetGroupId: undefined, preview: true }
    )
    expect(mocks.calls.openFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/repo/wt/src/file.ts',
        relativePath: 'src/file.ts',
        worktreeId: mocks.activeWorktree.id,
        language: 'typescript',
        mode: 'edit',
        runtimeEnvironmentId: undefined,
        operationProvenance: expect.objectContaining({
          generation: expect.objectContaining({
            route: { executionHostId: 'local', runtimeEnvironmentId: null }
          })
        })
      }),
      {
        targetGroupId: undefined,
        preview: false,
        focusEditor: true,
        suppressActiveRuntimeFallback: true
      }
    )
    expect(mocks.calls.statRuntimePath).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeId: mocks.activeWorktree.id,
        expectedExecutionHostId: 'local'
      }),
      '/repo/wt/src/file.ts'
    )
    expect(mocks.state.setEditorViewMode).toHaveBeenCalledWith('file-1', 'edit')
  })

  it('reuses the modifier-click split for the working-file double-click', async () => {
    resetState({
      gitStatusByWorktree: { [mocks.activeWorktree.id]: [gitEntry({ path: 'src/file.ts' })] }
    })
    renderSourceControl()

    await doubleClickUncommitted('src/file.ts', { ctrlKey: true })

    expect(mocks.calls.createEmptySplitGroup).toHaveBeenCalledTimes(1)
    expect(mocks.calls.openDiff).toHaveBeenCalledWith(
      mocks.activeWorktree.id,
      '/repo/wt/src/file.ts',
      'src/file.ts',
      'typescript',
      false,
      { targetGroupId: 'group-2', preview: false }
    )
    expect(mocks.calls.openFile).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: '/repo/wt/src/file.ts' }),
      expect.objectContaining({ targetGroupId: 'group-2', preview: false })
    )
  })

  it('does not treat a nested stage control double-click as a working-file open', async () => {
    resetState({
      gitStatusByWorktree: { [mocks.activeWorktree.id]: [gitEntry({ path: 'src/file.ts' })] }
    })
    renderSourceControl()

    const row = container.querySelector<HTMLDivElement>('[data-source-control-path="src/file.ts"]')
    const stageButton = row?.querySelector<HTMLButtonElement>('button[aria-label="Stage"]')
    expect(stageButton).not.toBeNull()
    await act(async () => {
      stageButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
      stageButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
      stageButton?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }))
      await Promise.resolve()
    })

    expect(mocks.calls.openDiff).not.toHaveBeenCalled()
    expect(mocks.calls.openFile).not.toHaveBeenCalled()
  })

  it('opens Markdown rows as preview diffs while preserving conflict-file routing', () => {
    resetState({
      gitStatusByWorktree: {
        [mocks.activeWorktree.id]: [
          gitEntry({ path: 'docs/readme.md' }),
          gitEntry({
            path: 'src/conflict.ts',
            conflictKind: 'both_modified',
            conflictStatus: 'unresolved'
          })
        ]
      }
    })
    renderSourceControl()

    clickUncommitted('docs/readme.md')
    clickUncommitted('src/conflict.ts')

    expect(mocks.calls.openDiff).toHaveBeenCalledWith(
      mocks.activeWorktree.id,
      '/repo/wt/docs/readme.md',
      'docs/readme.md',
      'markdown',
      false,
      { targetGroupId: undefined, preview: true }
    )
    expect(mocks.calls.openConflictFile).toHaveBeenCalledWith(
      mocks.activeWorktree.id,
      '/repo/wt',
      expect.objectContaining({ path: 'src/conflict.ts' }),
      'typescript',
      { targetGroupId: undefined, preview: true }
    )
  })

  it('scopes discard autosave quiesce and reload notifications to the active runtime', async () => {
    resetState({
      gitStatusByWorktree: { [mocks.activeWorktree.id]: [gitEntry({ path: 'src/file.ts' })] }
    })
    renderSourceControl()
    mocks.state.settings = { activeRuntimeEnvironmentId: 'runtime-remote' }

    const row = container.querySelector<HTMLDivElement>('[data-source-control-path="src/file.ts"]')
    const discardButton = row?.querySelector<HTMLButtonElement>(
      'button[aria-label="Discard changes"]'
    )
    expect(discardButton).not.toBeNull()
    act(() => {
      discardButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const confirmButton = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === 'Discard'
    )
    expect(confirmButton).not.toBeNull()
    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mocks.calls.quiesceDocumentSave).not.toHaveBeenCalled()
    expect(mocks.calls.notifyEditorExternalFileChange).toHaveBeenCalledWith({
      worktreeId: mocks.activeWorktree.id,
      worktreePath: '/repo/wt',
      relativePath: 'src/file.ts',
      runtimeEnvironmentId: 'runtime-remote'
    })
  })

  it('keeps nested-only submodule rows non-stageable from the parent repo', () => {
    resetState({
      gitStatusByWorktree: {
        [mocks.activeWorktree.id]: [
          gitEntry({
            path: 'packages/nested',
            submodule: { commitChanged: false, trackedChanges: true, untrackedChanges: false }
          })
        ]
      }
    })
    renderSourceControl()

    const row = container.querySelector<HTMLDivElement>(
      '[data-source-control-path="packages/nested"]'
    )
    expect(row?.textContent).toContain('Stage inside submodule')
    expect(
      row?.querySelector('[title*="cannot stage file changes inside a submodule"]')
    ).not.toBeNull()

    expect(row?.querySelector<HTMLButtonElement>('button[aria-label="Stage"]')).toBeNull()
  })

  it('does not render a commit-area Stage All primary for submodule worktree-only rows', () => {
    resetState({
      gitStatusByWorktree: {
        [mocks.activeWorktree.id]: [
          gitEntry({
            path: 'june-11th-launch',
            submodule: { commitChanged: false, trackedChanges: true, untrackedChanges: false }
          })
        ]
      }
    })
    renderSourceControl()

    const row = container.querySelector<HTMLDivElement>(
      '[data-source-control-path="june-11th-launch"]'
    )
    expect(row?.textContent).toContain('Stage inside submodule')

    const stageAllButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === 'Stage All'
    )
    expect(stageAllButton).toBeUndefined()

    const commitButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === 'Commit'
    )
    expect(commitButton).toBeDefined()
    expect(commitButton?.disabled).toBe(true)

    act(() => {
      commitButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(mocks.calls.bulkStageRuntimeGitPaths).not.toHaveBeenCalled()
  })

  it('keeps the commit-area Stage All primary for changed submodule gitlinks', async () => {
    resetState({
      gitStatusByWorktree: {
        [mocks.activeWorktree.id]: [
          gitEntry({
            path: 'packages/nested',
            submodule: { commitChanged: true, trackedChanges: false, untrackedChanges: false }
          })
        ]
      }
    })
    renderSourceControl()

    const stageAllButton = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === 'Stage All'
    )
    expect(stageAllButton).toBeDefined()
    expect(stageAllButton?.disabled).toBe(false)

    await act(async () => {
      stageAllButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    expect(mocks.calls.bulkStageRuntimeGitPaths).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: mocks.activeWorktree.id, worktreePath: '/repo/wt' }),
      ['packages/nested']
    )
  })

  it('passes preview=true when a plain branch row click opens a branch diff tab', () => {
    resetState({
      gitBranchChangesByWorktree: { [mocks.activeWorktree.id]: [branchEntry()] },
      gitBranchCompareSummaryByWorktree: { [mocks.activeWorktree.id]: branchSummary() }
    })
    renderSourceControl()
    act(() =>
      within(container)
        .getByRole('button', { name: /Committed on Branch/ })
        .click()
    )

    clickBranchRow()

    expect(mocks.calls.openBranchDiff).toHaveBeenCalledWith(
      mocks.activeWorktree.id,
      '/repo/wt',
      expect.objectContaining({ path: 'src/branch.ts' }),
      expect.objectContaining({ status: 'ready' }),
      'typescript',
      { targetGroupId: undefined, preview: true }
    )
  })

  it('opens a preview branch diff on the first click and the current working file on double-click', async () => {
    resetState({
      gitBranchChangesByWorktree: { [mocks.activeWorktree.id]: [branchEntry()] },
      gitBranchCompareSummaryByWorktree: { [mocks.activeWorktree.id]: branchSummary() }
    })
    renderSourceControl()
    act(() =>
      within(container)
        .getByRole('button', { name: /Committed on Branch/ })
        .click()
    )

    await doubleClickBranchRow()

    expect(mocks.calls.openBranchDiff).toHaveBeenCalledTimes(1)
    expect(mocks.calls.openBranchDiff).toHaveBeenCalledWith(
      mocks.activeWorktree.id,
      '/repo/wt',
      expect.objectContaining({ path: 'src/branch.ts' }),
      expect.objectContaining({ status: 'ready' }),
      'typescript',
      { targetGroupId: undefined, preview: true }
    )
    expect(mocks.calls.openFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/repo/wt/src/branch.ts',
        relativePath: 'src/branch.ts',
        worktreeId: mocks.activeWorktree.id,
        language: 'typescript',
        mode: 'edit'
      }),
      expect.objectContaining({ preview: false, focusEditor: true })
    )
  })
})
