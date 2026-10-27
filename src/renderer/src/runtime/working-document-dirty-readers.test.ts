import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../store'
import type { AppState } from '../store/types'
import { buildEditorSessionData } from '../lib/workspace-session'
import { sameOpenFiles } from './web-session-tabs-sync/state-equality-files'
import { buildRuntimeMobileOpenFilesProjection } from './sync-runtime-graph/sync-projections'
import { buildMobileSessionTabSnapshots } from './sync-runtime-graph/mobile-session-snapshots'
import { makeState } from './sync-runtime-graph-test-harness'
import type { Tab } from '../../../shared/tab-types'
import { setTestDraft } from '../store/slices/editor/working-document-drafts.test-fixture'

vi.mock('@/lib/connection-context', () => ({
  getConnectionIdForFile: () => null
}))

const FILE_ID = '/repo/README.md'

function resetEditorState(): void {
  useAppStore.setState({ openFiles: [], workingDocuments: {}, workingDocumentIdsByTab: {} })
  const tab: Tab = {
    id: 'tab-md',
    entityId: FILE_ID,
    groupId: 'group-1',
    worktreeId: 'wt-1',
    contentType: 'editor',
    label: FILE_ID,
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
  useAppStore.setState({ unifiedTabsByWorktree: { 'wt-1': [tab] } })
}

function openMarkdownFile(): void {
  useAppStore.getState().openFile({
    filePath: FILE_ID,
    relativePath: 'README.md',
    worktreeId: 'wt-1',
    language: 'markdown',
    mode: 'edit'
  })
}

/** Dirties the tab through its working document and returns the store on either side. */
function dirtyThroughDocument(): { before: AppState; after: AppState } {
  const before = useAppStore.getState()
  setTestDraft(useAppStore, FILE_ID, '# edited\n')
  const after = useAppStore.getState()
  expect(after.openFiles.find((file) => file.id === FILE_ID)?.isDirty).toBe(true)
  return { before, after }
}

describe('a dirty change on the working document reaches every openFiles reader', () => {
  beforeEach(() => {
    resetEditorState()
    openMarkdownFile()
  })

  it('web session tab sync sees the open files change', () => {
    const { before, after } = dirtyThroughDocument()

    expect(sameOpenFiles(before.openFiles, after.openFiles)).toBe(false)
  })

  it('session save persists the draft of the now-dirty tab', () => {
    const save = (state: AppState) =>
      buildEditorSessionData(
        state.openFiles,
        state,
        state.markdownFrontmatterVisible,
        state.activeFileIdByWorktree,
        state.activeTabTypeByWorktree
      ).openFilesByWorktree?.['wt-1']?.[0]?.dirtyDraftContent

    const { before, after } = dirtyThroughDocument()

    expect(save(before)).toBeUndefined()
    expect(save(after)).toBe('# edited\n')
  })

  it('mobile session projections publish the dirty flag', () => {
    const { before, after } = dirtyThroughDocument()
    const markdownTab = (state: AppState) =>
      buildMobileSessionTabSnapshots(
        makeState({
          openFiles: state.openFiles,
          workingDocuments: state.workingDocuments,
          workingDocumentIdsByTab: state.workingDocumentIdsByTab,
          unifiedTabsByWorktree: state.unifiedTabsByWorktree,
          tabBarOrderByWorktree: { 'wt-1': [FILE_ID] }
        })
      )[0]?.tabs.find((tab) => tab.type === 'markdown')

    expect(buildRuntimeMobileOpenFilesProjection(after.openFiles)).not.toBe(
      buildRuntimeMobileOpenFilesProjection(before.openFiles)
    )
    expect(markdownTab(before)).toMatchObject({ isDirty: false })
    expect(markdownTab(after)).toMatchObject({ isDirty: true })
  })
})
