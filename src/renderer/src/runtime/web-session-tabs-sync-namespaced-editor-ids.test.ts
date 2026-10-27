import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '../../../shared/tab-types'
import type { OpenFile } from '../store/slices/editor'
import { applyWebSessionTabsSnapshot } from './web-session-tabs-sync/snapshot-api'
import type { WebSessionTabsSyncState } from './web-session-tabs-sync/state'
import { getWorkingDocumentId } from '../store/slices/editor/working-document'
import { testWorkingDocumentTarget } from '../store/slices/editor/working-document-drafts.test-fixture'
import {
  ENV,
  NOW,
  WT,
  makeSnapshot,
  makeState,
  resetWebSessionTabsSyncTestState
} from './web-session-tabs-sync-test-harness'

vi.mock('../store', () => ({
  useAppStore: {
    setState: vi.fn()
  }
}))

describe('applyWebSessionTabsSnapshot namespaced editor ids', () => {
  beforeEach(resetWebSessionTabsSyncTestState)

  it('adopts namespaced editor and diff ids without duplicating their unified tab placement', () => {
    const edit: OpenFile = {
      id: 'editor:repo::/worktree:runtime:web-env-1:/repo/src/app.ts',
      filePath: '/repo/src/app.ts',
      relativePath: 'src/app.ts',
      worktreeId: WT,
      language: 'typescript',
      isDirty: true,
      runtimeEnvironmentId: ENV,
      mode: 'edit'
    }
    const diff: OpenFile = {
      id: 'editor-diff:repo::/worktree:web-env-1:unstaged:src/app.ts',
      filePath: '/repo/src/app.ts',
      relativePath: 'src/app.ts',
      worktreeId: WT,
      language: 'typescript',
      isDirty: false,
      runtimeEnvironmentId: ENV,
      mode: 'diff',
      diffSource: 'unstaged'
    }
    const target = testWorkingDocumentTarget(edit)
    const documentId = getWorkingDocumentId(target.owner, target.filePath)
    const localTabs: Tab[] = [
      {
        id: 'local-edit-tab',
        entityId: edit.id,
        groupId: 'local-group',
        worktreeId: WT,
        contentType: 'editor',
        label: 'app.ts',
        customLabel: null,
        color: null,
        sortOrder: 0,
        createdAt: NOW - 2,
        isPreview: false,
        isPinned: false
      },
      {
        id: 'local-diff-tab',
        entityId: diff.id,
        groupId: 'local-group',
        worktreeId: WT,
        contentType: 'diff',
        label: 'app.ts',
        customLabel: null,
        color: null,
        sortOrder: 1,
        createdAt: NOW - 1,
        isPreview: false,
        isPinned: false
      }
    ]
    const patch = applyWebSessionTabsSnapshot(
      makeState({
        // The client's own unsaved edits keep the edit tab dirty over the host's clean flag.
        workingDocuments: {
          [documentId]: {
            id: documentId,
            target,
            content: 'client edit',
            revision: 2,
            isDirty: true,
            loadState: 'ready',
            writable: true,
            alwaysAutoSave: false
          }
        },
        workingDocumentIdsByTab: { 'local-edit-tab': [documentId], 'local-diff-tab': [documentId] },
        activeTabId: 'local-diff-tab',
        activeTabIdByWorktree: { [WT]: 'local-diff-tab' },
        activeFileId: diff.id,
        activeFileIdByWorktree: { [WT]: diff.id },
        activeTabType: 'editor',
        activeTabTypeByWorktree: { [WT]: 'editor' },
        openFiles: [edit, diff],
        unifiedTabsByWorktree: { [WT]: localTabs },
        groupsByWorktree: {
          [WT]: [
            {
              id: 'local-group',
              worktreeId: WT,
              activeTabId: 'local-diff-tab',
              tabOrder: ['local-edit-tab', 'local-diff-tab'],
              recentTabIds: ['local-edit-tab', 'local-diff-tab']
            }
          ]
        }
      }),
      makeSnapshot(
        [
          {
            type: 'file',
            id: 'host-edit-tab',
            title: 'app.ts',
            filePath: edit.filePath,
            relativePath: edit.relativePath,
            language: edit.language,
            mode: 'edit',
            isDirty: false,
            isActive: true
          },
          {
            type: 'file',
            id: 'host-diff-tab',
            title: 'app.ts',
            filePath: diff.filePath,
            relativePath: diff.relativePath,
            language: diff.language,
            mode: 'diff',
            diffSource: 'unstaged',
            isDirty: false,
            isActive: false
          }
        ],
        { activeTabId: 'host-edit-tab', activeTabType: 'file' }
      ),
      ENV,
      NOW
    ) as Partial<WebSessionTabsSyncState>

    expect(patch.openFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: edit.id, isDirty: true, mirroredFromRuntimeSession: true }),
        expect.objectContaining({
          id: diff.id,
          mode: 'diff',
          diffSource: 'unstaged',
          mirroredFromRuntimeSession: true
        })
      ])
    )
    expect(patch.openFiles).toHaveLength(2)
    expect(patch.unifiedTabsByWorktree?.[WT]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'host-edit-tab', entityId: edit.id, contentType: 'editor' }),
        expect.objectContaining({ id: 'host-diff-tab', entityId: diff.id, contentType: 'diff' })
      ])
    )
    expect(patch.unifiedTabsByWorktree?.[WT]).toHaveLength(2)
    expect(patch.groupsByWorktree?.[WT]?.[0]).toMatchObject({
      activeTabId: 'host-diff-tab',
      tabOrder: ['host-edit-tab', 'host-diff-tab']
    })
  })
})
