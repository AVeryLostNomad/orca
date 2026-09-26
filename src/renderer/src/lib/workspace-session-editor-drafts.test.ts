import { describe, expect, it } from 'vitest'
import type { WorkspaceSessionSnapshot } from './workspace-session'
import type { WorkingDocument, WorkingDocumentId } from '../store/slices/editor/working-document'
import { buildWorkspaceSessionPayload } from './workspace-session'

function workingDocument(
  id: string,
  filePath: string,
  content: string | undefined,
  isDirty: boolean,
  overrides: Record<string, unknown> = {}
): WorkingDocument {
  return {
    id: id as WorkingDocumentId,
    target: {
      owner: { executionHostId: 'local', runtimeEnvironmentId: null },
      filePath,
      relativePath: filePath.slice(filePath.lastIndexOf('/') + 1),
      worktreeId: 'wt-1',
      language: 'markdown',
      operationProvenance: {}
    },
    content,
    revision: 1,
    isDirty,
    loadState: 'ready',
    writable: true,
    alwaysAutoSave: false,
    ...overrides
  } as never
}

function createSnapshot(
  overrides: Omit<
    Partial<WorkspaceSessionSnapshot>,
    'workingDocuments' | 'workingDocumentIdsByTab'
  > & {
    workingDocuments?: Record<string, WorkingDocument>
    workingDocumentIdsByTab?: Record<string, readonly string[]>
  } = {}
): WorkspaceSessionSnapshot {
  return {
    activeRepoId: 'repo-1',
    activeWorkspaceKey: 'worktree:wt-1',
    activeWorktreeId: 'wt-1',
    activeTabId: 'tab-1',
    tabsByWorktree: {},
    ptyIdsByTabId: {},
    terminalLayoutsByTabId: {},
    activeTabIdByWorktree: {},
    openFiles: [],
    workingDocuments: {},
    workingDocumentIdsByTab: {},
    markdownFrontmatterVisible: {},
    activeFileIdByWorktree: {},
    activeTabTypeByWorktree: {},
    browserTabsByWorktree: {},
    browserPagesByWorkspace: {},
    remoteBrowserPageHandlesByPageId: {},
    activeBrowserTabIdByWorktree: {},
    codeServerTabsByWorktree: {},
    activeCodeServerTabIdByWorktree: {},
    dataStudioTabsByWorktree: {},
    activeDataStudioTabIdByWorktree: {},
    browserUrlHistory: [],
    workspaceDocHistory: [],
    unifiedTabsByWorktree: {},
    groupsByWorktree: {},
    layoutByWorktree: {},
    activeGroupIdByWorktree: {},
    sshConnectionStates: new Map(),
    repos: [],
    worktreesByRepo: {},
    lastKnownRelayPtyIdByTabId: {},
    lastVisitedAtByWorktreeId: {},
    defaultTerminalTabsAppliedByWorktreeId: {},
    closedTerminalTabTombstonesByTabId: {},
    ...overrides
  } as unknown as WorkspaceSessionSnapshot
}

describe('workspace session editor drafts', () => {
  it('persists canonical dirty content without saving clean document content', () => {
    const payload = buildWorkspaceSessionPayload(
      createSnapshot({
        openFiles: [
          {
            id: '/tmp/dirty.md',
            filePath: '/tmp/dirty.md',
            relativePath: 'dirty.md',
            worktreeId: 'wt-1',
            language: 'markdown',
            mode: 'edit',
            isDirty: true
          } as never,
          {
            id: '/tmp/clean.md',
            filePath: '/tmp/clean.md',
            relativePath: 'clean.md',
            worktreeId: 'wt-1',
            language: 'markdown',
            mode: 'edit',
            isDirty: false
          } as never
        ],
        workingDocuments: {
          dirty: workingDocument('dirty', '/tmp/dirty.md', '', true),
          clean: workingDocument('clean', '/tmp/clean.md', 'clean content', false)
        },
        workingDocumentIdsByTab: {
          '/tmp/dirty.md': ['dirty'],
          '/tmp/clean.md': ['clean']
        }
      })
    )

    expect(payload.openFilesByWorktree?.['wt-1']).toEqual([
      expect.objectContaining({ filePath: '/tmp/dirty.md', dirtyDraftContent: '' }),
      expect.not.objectContaining({ dirtyDraftContent: expect.any(String) })
    ])
  })

  it('persists the validated host and SSH target from the document target', () => {
    const payload = buildWorkspaceSessionPayload(
      createSnapshot({
        openFiles: [
          {
            id: '/tmp/ssh.md',
            filePath: '/tmp/ssh.md',
            relativePath: '/tmp/ssh.md',
            worktreeId: 'wt-1',
            language: 'markdown',
            mode: 'edit',
            isDirty: false
          } as never
        ],
        workingDocuments: {
          ssh: workingDocument('ssh', '/tmp/ssh.md', 'content', false, {
            target: {
              owner: { executionHostId: 'ssh:host-1', runtimeEnvironmentId: null },
              filePath: '/tmp/ssh.md',
              relativePath: '/tmp/ssh.md',
              worktreeId: 'wt-1',
              language: 'markdown',
              externalSshTargetId: 'ssh-1',
              operationProvenance: {}
            }
          })
        },
        workingDocumentIdsByTab: { '/tmp/ssh.md': ['ssh'] }
      })
    )

    expect(payload.openFilesByWorktree?.['wt-1']?.[0]).toEqual(
      expect.objectContaining({ executionHostId: 'ssh:host-1', externalSshTargetId: 'ssh-1' })
    )
  })

  it('persists the disk baseline only with a dirty canonical document', () => {
    const payload = buildWorkspaceSessionPayload(
      createSnapshot({
        openFiles: [
          {
            id: '/tmp/dirty.md',
            filePath: '/tmp/dirty.md',
            relativePath: 'dirty.md',
            worktreeId: 'wt-1',
            language: 'markdown',
            mode: 'edit',
            isDirty: true
          } as never,
          {
            id: '/tmp/clean.md',
            filePath: '/tmp/clean.md',
            relativePath: 'clean.md',
            worktreeId: 'wt-1',
            language: 'markdown',
            mode: 'edit',
            isDirty: false
          } as never
        ],
        workingDocuments: {
          dirty: workingDocument('dirty', '/tmp/dirty.md', 'unsaved edits', true, {
            lastKnownDiskSignature: 'abc123'
          }),
          clean: workingDocument('clean', '/tmp/clean.md', 'clean content', false, {
            lastKnownDiskSignature: 'def456'
          })
        },
        workingDocumentIdsByTab: {
          '/tmp/dirty.md': ['dirty'],
          '/tmp/clean.md': ['clean']
        }
      })
    )

    expect(payload.openFilesByWorktree?.['wt-1']).toEqual([
      expect.objectContaining({
        filePath: '/tmp/dirty.md',
        dirtyDraftContent: 'unsaved edits',
        lastKnownDiskSignature: 'abc123'
      }),
      expect.not.objectContaining({ lastKnownDiskSignature: expect.any(String) })
    ])
  })

  it('keeps read-only edit tabs read-only without recovering a draft', () => {
    const payload = buildWorkspaceSessionPayload(
      createSnapshot({
        openFiles: [
          {
            id: '/home/user/.claude/log.jsonl',
            filePath: '/home/user/.claude/log.jsonl',
            relativePath: '/home/user/.claude/log.jsonl',
            worktreeId: 'wt-1',
            language: 'jsonl',
            mode: 'edit',
            isDirty: true,
            readOnly: true,
            liveTail: true
          } as never
        ]
      })
    )

    expect(payload.openFilesByWorktree?.['wt-1']?.[0]).toEqual(
      expect.objectContaining({ readOnly: true, liveTail: true })
    )
    expect(payload.openFilesByWorktree?.['wt-1']?.[0]).toEqual(
      expect.not.objectContaining({ dirtyDraftContent: expect.any(String) })
    )
  })

  it('recovers each dirty combined-only document once, including an empty draft', () => {
    const payload = buildWorkspaceSessionPayload(
      createSnapshot({
        openFiles: [
          {
            id: 'combined:wt-1',
            filePath: '/repo',
            relativePath: '',
            worktreeId: 'wt-1',
            language: 'diff',
            mode: 'diff',
            diffSource: 'combined-uncommitted',
            isDirty: false
          } as never
        ],
        workingDocuments: {
          empty: workingDocument('empty', '/repo/new.md', '', true),
          text: workingDocument('text', '/repo/changed.md', 'unsaved', true)
        },
        workingDocumentIdsByTab: { 'combined:wt-1': ['empty', 'text'] }
      })
    )

    expect(payload.openFilesByWorktree?.['wt-1']).toEqual([
      expect.objectContaining({ filePath: '/repo/new.md', dirtyDraftContent: '' }),
      expect.objectContaining({ filePath: '/repo/changed.md', dirtyDraftContent: 'unsaved' })
    ])
  })
})
