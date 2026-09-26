import { beforeEach, describe, expect, it } from 'vitest'
import { getDiskBaselineSignature } from '@/components/editor/diff-content-signature'
import { useAppStore } from '@/store'
import { getWorkingDocumentForFile } from './editor/working-document-state'
import type { WorkingDocumentTarget } from './editor/working-document'
import type { OpenFilePathRekey } from './editor'
import type { Tab, TabGroup } from '../../../../shared/tab-types'

// Stage-1 foundation: rekeyOpenFilesForPathChange atomically retargets an open
// edit session across an Orca-owned move (no close/reopen), preserving all
// id-keyed state and failing closed on collision/stale without mutating.

function seedEditTab(overrides: Partial<Record<string, unknown>> = {}): void {
  const state = useAppStore.getState()
  state.openFile(
    {
      filePath: '/repo/a.md',
      relativePath: 'a.md',
      worktreeId: 'wt-1',
      runtimeEnvironmentId: null,
      language: 'markdown',
      mode: 'edit'
    },
    { suppressActiveRuntimeFallback: true }
  )
  const id = useAppStore.getState().openFiles[0]!.id
  const target = {
    owner: { executionHostId: 'local', runtimeEnvironmentId: null },
    filePath: '/repo/a.md',
    worktreeId: 'wt-1',
    relativePath: 'a.md',
    language: 'markdown',
    operationProvenance: {
      generation: { route: { executionHostId: 'local', runtimeEnvironmentId: null } }
    }
  } as WorkingDocumentTarget
  useAppStore.setState((current) => ({
    openFiles: current.openFiles.map((file) =>
      file.id === id ? { ...file, operationProvenance: target.operationProvenance } : file
    )
  }))
  state.retainWorkingDocument(id, target)
  const document = getWorkingDocumentForFile(useAppStore.getState(), id)
  if (!document) {
    throw new Error(`Expected working document for ${id}`)
  }
  const diskContent = 'saved copy'
  state.acceptWorkingDocumentLoad(
    document.id,
    document.revision,
    diskContent,
    getDiskBaselineSignature(diskContent)
  )
  state.setWorkingDocumentContent(document.id, '20 min of work')
  useAppStore.setState((s) => ({
    editorCursorLine: { ...s.editorCursorLine, [id]: 42 },
    markdownViewMode: { ...s.markdownViewMode, [id]: 'rendered' } as never,
    activeFileId: id,
    activeFileIdByWorktree: { ...s.activeFileIdByWorktree, 'wt-1': id },
    tabBarOrderByWorktree: { ...s.tabBarOrderByWorktree, 'wt-1': [id] },
    ...overrides
  }))
}

function rekeyFor(oldId: string, newPath: string, newRel: string): OpenFilePathRekey {
  return {
    oldFileId: oldId,
    newFileId: newPath, // path-derived id for a local tab
    oldFilePath: '/repo/a.md',
    newFilePath: newPath,
    newRelativePath: newRel
  }
}

describe('rekeyOpenFilesForPathChange', () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true)
  })

  it('retargets the session preserving canonical content, baseline, cursor, view, active, tab bar', () => {
    seedEditTab()
    const oldId = useAppStore.getState().openFiles[0]!.id
    const newPath = '/repo/sub/a.md'

    const result = useAppStore.getState().rekeyOpenFilesForPathChange({
      rekeys: [rekeyFor(oldId, newPath, 'sub/a.md')]
    })

    expect(result).toEqual({ ok: true })
    const s = useAppStore.getState()
    const moved = s.openFiles[0]!
    expect(moved.id).toBe(newPath)
    expect(moved.filePath).toBe(newPath)
    expect(moved.relativePath).toBe('sub/a.md')
    const movedDocument = getWorkingDocumentForFile(s, moved.id)
    expect(movedDocument).toMatchObject({
      content: '20 min of work',
      isDirty: true,
      lastKnownDiskSignature: getDiskBaselineSignature('saved copy')
    })
    expect(s.editorCursorLine[newPath]).toBe(42)
    expect(s.editorCursorLine[oldId]).toBeUndefined()
    expect(s.markdownViewMode[newPath]).toBe('rendered')
    expect(s.activeFileId).toBe(newPath)
    expect(s.activeFileIdByWorktree['wt-1']).toBe(newPath)
    expect(s.tabBarOrderByWorktree['wt-1']).toEqual([newPath])
  })

  it('migrates unified tab entityId/id and group order', () => {
    seedEditTab()
    const oldId = useAppStore.getState().openFiles[0]!.id
    const tab: Tab = {
      id: oldId,
      entityId: oldId,
      contentType: 'editor',
      groupId: 'g1',
      title: 'a.md'
    } as never
    const group: TabGroup = {
      id: 'g1',
      tabOrder: [oldId],
      activeTabId: oldId,
      recentTabIds: [oldId]
    } as never
    useAppStore.setState({
      unifiedTabsByWorktree: { 'wt-1': [tab] },
      groupsByWorktree: { 'wt-1': [group] }
    } as never)
    const newPath = '/repo/sub/a.md'

    useAppStore.getState().rekeyOpenFilesForPathChange({
      rekeys: [rekeyFor(oldId, newPath, 'sub/a.md')]
    })

    const s = useAppStore.getState()
    const movedTab = s.unifiedTabsByWorktree['wt-1']![0]!
    expect(movedTab.entityId).toBe(newPath)
    expect(movedTab.id).toBe(newPath)
    const movedGroup = s.groupsByWorktree['wt-1']![0]!
    expect(movedGroup.tabOrder).toEqual([newPath])
    expect(movedGroup.activeTabId).toBe(newPath)
    expect(movedGroup.recentTabIds).toEqual([newPath])
  })

  it('rejects a collision with a distinct live session and mutates nothing', () => {
    seedEditTab()
    const oldId = useAppStore.getState().openFiles[0]!.id
    // A second, unrelated open tab already lives at the destination id.
    useAppStore.getState().openFile(
      {
        filePath: '/repo/sub/a.md',
        relativePath: 'sub/a.md',
        worktreeId: 'wt-1',
        runtimeEnvironmentId: null,
        language: 'markdown',
        mode: 'edit'
      },
      { suppressActiveRuntimeFallback: true }
    )
    const before = useAppStore.getState().openFiles.map((f) => f.id)

    const result = useAppStore.getState().rekeyOpenFilesForPathChange({
      rekeys: [rekeyFor(oldId, '/repo/sub/a.md', 'sub/a.md')]
    })

    expect(result).toEqual({ ok: false, reason: 'collision' })
    expect(useAppStore.getState().openFiles.map((f) => f.id)).toEqual(before)
  })

  it('reports stale when a source id is no longer open, mutating nothing', () => {
    seedEditTab()
    const before = useAppStore.getState().openFiles.map((f) => f.id)

    const result = useAppStore.getState().rekeyOpenFilesForPathChange({
      rekeys: [rekeyFor('editor:gone', '/repo/sub/a.md', 'sub/a.md')]
    })

    expect(result).toEqual({ ok: false, reason: 'stale' })
    expect(useAppStore.getState().openFiles.map((f) => f.id)).toEqual(before)
  })

  it('consumes untitled status on an explicit rename', () => {
    const state = useAppStore.getState()
    state.openFile(
      {
        filePath: '/repo/untitled.md',
        relativePath: 'untitled.md',
        worktreeId: 'wt-1',
        runtimeEnvironmentId: null,
        language: 'markdown',
        mode: 'edit',
        isUntitled: true
      },
      { suppressActiveRuntimeFallback: true }
    )
    const oldId = useAppStore.getState().openFiles[0]!.id

    useAppStore.getState().rekeyOpenFilesForPathChange({
      rekeys: [
        {
          oldFileId: oldId,
          newFileId: '/repo/named.md',
          oldFilePath: '/repo/untitled.md',
          newFilePath: '/repo/named.md',
          newRelativePath: 'named.md',
          consumeUntitled: true
        }
      ]
    })

    const moved = useAppStore.getState().openFiles[0]!
    expect(moved.isUntitled).toBeUndefined()
    expect(moved.filePath).toBe('/repo/named.md')
  })

  it('installs the move-echo gate + provenance on a dirty destination when moveOperationId is set', () => {
    seedEditTab()
    const oldId = useAppStore.getState().openFiles[0]!.id
    const newPath = '/repo/sub/a.md'

    useAppStore.getState().rekeyOpenFilesForPathChange({
      rekeys: [rekeyFor(oldId, newPath, 'sub/a.md')],
      moveOperationId: 'op-42'
    })

    const moved = useAppStore.getState().openFiles[0]!
    const document = getWorkingDocumentForFile(useAppStore.getState(), moved.id)
    expect(document).toMatchObject({
      pendingLiveDiskVerification: true,
      pendingSelfMoveEcho: { operationId: 'op-42', targetPath: newPath }
    })
  })

  it('does not gate a document already showing the changed-on-disk banner', () => {
    seedEditTab()
    const oldId = useAppStore.getState().openFiles[0]!.id
    const document = getWorkingDocumentForFile(useAppStore.getState(), oldId)
    if (!document) {
      throw new Error('Expected dirty working document')
    }
    useAppStore.getState().setWorkingDocumentExternalState(document.id, {
      externalMutation: 'changed'
    })

    useAppStore.getState().rekeyOpenFilesForPathChange({
      rekeys: [rekeyFor(oldId, '/repo/sub/a.md', 'sub/a.md')],
      moveOperationId: 'op-42'
    })

    const moved = useAppStore.getState().openFiles[0]!
    const movedDocument = getWorkingDocumentForFile(useAppStore.getState(), moved.id)
    expect(movedDocument?.externalMutation).toBe('changed')
    expect(movedDocument?.pendingLiveDiskVerification).toBeUndefined()
    expect(movedDocument?.pendingSelfMoveEcho).toBeUndefined()
  })

  it('migrates a pending editor reveal keyed by fileId to the new tab id', () => {
    seedEditTab()
    const oldId = useAppStore.getState().openFiles[0]!.id
    useAppStore.setState({
      pendingEditorReveal: { fileId: oldId, filePath: '/repo/a.md', line: 40, requestId: 1 }
    } as never)

    useAppStore.getState().rekeyOpenFilesForPathChange({
      rekeys: [rekeyFor(oldId, '/repo/sub/a.md', 'sub/a.md')]
    })

    const reveal = useAppStore.getState().pendingEditorReveal!
    expect(reveal.fileId).toBe(useAppStore.getState().openFiles[0]!.id)
    expect(reveal.filePath).toBe('/repo/sub/a.md')
  })

  it('does not gate a clean destination', () => {
    seedEditTab()
    const oldId = useAppStore.getState().openFiles[0]!.id
    const document = getWorkingDocumentForFile(useAppStore.getState(), oldId)
    if (!document) {
      throw new Error('Expected working document')
    }
    useAppStore
      .getState()
      .discardWorkingDocumentEdits(
        document.id,
        '20 min of work',
        getDiskBaselineSignature('20 min of work')
      )

    useAppStore.getState().rekeyOpenFilesForPathChange({
      rekeys: [rekeyFor(oldId, '/repo/sub/a.md', 'sub/a.md')],
      moveOperationId: 'op-42'
    })

    const moved = useAppStore.getState().openFiles[0]!
    const movedDocument = getWorkingDocumentForFile(useAppStore.getState(), moved.id)
    expect(movedDocument?.pendingLiveDiskVerification).toBeUndefined()
    expect(movedDocument?.pendingSelfMoveEcho).toBeUndefined()
  })

  it('detaches a moved tab from the host mirror so the snapshot cannot cull it', () => {
    seedEditTab()
    const oldId = useAppStore.getState().openFiles[0]!.id
    useAppStore.setState((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.id === oldId ? { ...f, mirroredFromRuntimeSession: true } : f
      )
    }))

    useAppStore.getState().rekeyOpenFilesForPathChange({
      rekeys: [rekeyFor(oldId, '/repo/sub/a.md', 'sub/a.md')]
    })

    expect(useAppStore.getState().openFiles[0]!.mirroredFromRuntimeSession).toBeUndefined()
  })

  it('leaves a reveal keyed by another worktree file id untouched when only the path matches', () => {
    seedEditTab()
    // A same-path tab in a second worktree: the reveal belongs to it, not to the rekeyed tab.
    useAppStore.getState().openFile(
      {
        filePath: '/repo/a.md',
        relativePath: 'a.md',
        worktreeId: 'wt-2',
        runtimeEnvironmentId: null,
        language: 'markdown',
        mode: 'edit'
      },
      { suppressActiveRuntimeFallback: true }
    )
    const rekeyedId = useAppStore.getState().openFiles[0]!.id
    const otherWorktreeId = useAppStore.getState().openFiles[1]!.id
    expect(otherWorktreeId).not.toBe(rekeyedId)
    useAppStore.setState({
      pendingEditorReveal: { fileId: otherWorktreeId, filePath: '/repo/a.md', line: 40 }
    } as never)

    const result = useAppStore.getState().rekeyOpenFilesForPathChange({
      rekeys: [rekeyFor(rekeyedId, '/repo/sub/a.md', 'sub/a.md')]
    })

    expect(result).toEqual({ ok: true })
    expect(
      useAppStore.getState().openFiles.find((file) => file.id === '/repo/sub/a.md')
    ).toMatchObject({ filePath: '/repo/sub/a.md' })
    const reveal = useAppStore.getState().pendingEditorReveal!
    expect(reveal.fileId).toBe(otherWorktreeId)
    expect(reveal.filePath).toBe('/repo/a.md')
  })

  it('migrates a pending editor reveal to the new path', () => {
    seedEditTab()
    const oldId = useAppStore.getState().openFiles[0]!.id
    useAppStore.setState({
      pendingEditorReveal: { filePath: '/repo/a.md', requestId: 1 }
    } as never)

    useAppStore.getState().rekeyOpenFilesForPathChange({
      rekeys: [rekeyFor(oldId, '/repo/sub/a.md', 'sub/a.md')]
    })

    expect(useAppStore.getState().pendingEditorReveal?.filePath).toBe('/repo/sub/a.md')
  })
})
