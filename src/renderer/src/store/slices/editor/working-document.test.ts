import { describe, expect, it } from 'vitest'
import { getDiskBaselineSignature } from '@/components/editor/diff-content-signature'
import { createEditorStore } from '../editor-slice-test-harness'
import { getWorkingDocumentId, type WorkingDocumentTarget } from './working-document'
import { getEditorClosePlan } from './working-document-state'

const target = (filePath = '/repo/file.ts'): WorkingDocumentTarget =>
  ({
    owner: { executionHostId: 'local', runtimeEnvironmentId: null },
    filePath,
    worktreeId: 'wt-1',
    relativePath: filePath.slice('/repo/'.length),
    language: 'typescript',
    operationProvenance: {
      generation: { route: { executionHostId: 'local', runtimeEnvironmentId: null } }
    }
  }) as WorkingDocumentTarget

describe('working documents', () => {
  it('shares one owner-qualified document across retained tabs', () => {
    const store = createEditorStore()
    const first = store.getState().retainWorkingDocument('tab-1', target())
    const second = store.getState().retainWorkingDocument('tab-2', target())

    expect(second).toBe(first)
    expect(store.getState().workingDocumentIdsByTab).toEqual({
      'tab-1': [first],
      'tab-2': [first]
    })
  })

  it('accepts only the expected clean load and protects later user edits', () => {
    const store = createEditorStore()
    const id = store.getState().retainWorkingDocument('tab-1', target())

    store.getState().setWorkingDocumentLoadState(id, 0, 'loading')
    store.getState().acceptWorkingDocumentLoad(id, 0, 'disk', 'sig-1')
    store.getState().setWorkingDocumentContent(id, 'edited')
    store.getState().acceptWorkingDocumentLoad(id, 1, 'stale disk', 'sig-2')

    expect(store.getState().workingDocuments[id]).toMatchObject({
      content: 'edited',
      isDirty: true,
      lastKnownDiskSignature: 'sig-1'
    })
  })

  it('clears dirty state when undo restores the exact disk baseline', () => {
    const store = createEditorStore()
    const id = store.getState().retainWorkingDocument('tab-1', target())
    const baseline = 'const answer = 42\\n'
    store.getState().acceptWorkingDocumentLoad(id, 0, baseline, getDiskBaselineSignature(baseline))
    store.getState().setWorkingDocumentContent(id, 'const answer = 43\\n')
    store.getState().setWorkingDocumentContent(id, baseline)

    expect(store.getState().workingDocuments[id]?.isDirty).toBe(false)
  })

  it('keeps comparison-only formatting changes dirty until those exact bytes are saved', () => {
    const store = createEditorStore()
    const state = store.getState()
    const id = state.retainWorkingDocument('tab-1', target())
    const baseline = 'const answer = 42\n'
    const reformatted = '  const answer = 42  \r\n'
    state.acceptWorkingDocumentLoad(id, 0, baseline, getDiskBaselineSignature(baseline))
    state.setWorkingDocumentContent(id, reformatted)
    expect(store.getState().workingDocuments[id]).toMatchObject({
      content: reformatted,
      isDirty: true
    })
    state.commitWorkingDocumentSave(id, reformatted, getDiskBaselineSignature(reformatted))
    expect(store.getState().workingDocuments[id]).toMatchObject({
      content: reformatted,
      isDirty: false
    })
  })

  it('inherits always autosave from every owning file tab', () => {
    const store = createEditorStore()
    store.setState({
      openFiles: [{ id: 'tab-1', alwaysAutoSave: true }] as never
    })

    const id = store.getState().retainWorkingDocument('tab-1', target())

    expect(store.getState().workingDocuments[id]?.alwaysAutoSave).toBe(true)
  })

  it('keeps a dirty orphan after its final tab releases', () => {
    const store = createEditorStore()
    const id = store.getState().retainWorkingDocument('tab-1', target())
    store.getState().acceptWorkingDocumentLoad(id, 0, 'disk', 'sig')
    store.getState().setWorkingDocumentContent(id, '')
    store.getState().releaseWorkingDocumentsForTab('tab-1')

    expect(store.getState().workingDocuments[id]).toMatchObject({ content: '', isDirty: true })
    expect(store.getState().workingDocumentIdsByTab).toEqual({})
  })

  it('prompts once only when a batch closes every owning tab', () => {
    const store = createEditorStore()
    const id = store.getState().retainWorkingDocument('tab-1', target())
    store.getState().retainWorkingDocument('tab-2', target())
    store.getState().acceptWorkingDocumentLoad(id, 0, 'disk', 'sig')
    store.getState().setWorkingDocumentContent(id, 'edited')

    expect(getEditorClosePlan(store.getState(), ['tab-1']).dirtyDocumentIds).toEqual([])
    expect(getEditorClosePlan(store.getState(), ['tab-1', 'tab-2']).dirtyDocumentIds).toEqual([id])
  })

  it('expands a file entity close request to its actual unified tab surfaces', () => {
    const store = createEditorStore()
    const id = store.getState().retainWorkingDocument('surface-left', target())
    store.getState().retainWorkingDocument('surface-right', target())
    store.getState().acceptWorkingDocumentLoad(id, 0, 'disk', 'sig')
    store.getState().setWorkingDocumentContent(id, 'edited')
    store.setState({
      unifiedTabsByWorktree: {
        'wt-1': [
          { id: 'surface-left', entityId: '/repo/file.ts' },
          { id: 'surface-right', entityId: '/repo/file.ts' }
        ]
      }
    } as never)

    expect(getEditorClosePlan(store.getState(), ['surface-left']).dirtyDocumentIds).toEqual([])
    expect(getEditorClosePlan(store.getState(), ['/repo/file.ts'])).toEqual({
      tabIds: ['surface-left', 'surface-right'],
      dirtyDocumentIds: [id]
    })
  })

  it('uses owner and admitted path in the logical identity', () => {
    expect(getWorkingDocumentId(target().owner, '/repo/file.ts')).not.toBe(
      getWorkingDocumentId(
        { executionHostId: 'runtime:env-1' as never, runtimeEnvironmentId: 'env-1' },
        '/repo/file.ts'
      )
    )
  })
})
