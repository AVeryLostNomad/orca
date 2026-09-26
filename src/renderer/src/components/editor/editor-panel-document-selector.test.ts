import { describe, expect, it } from 'vitest'
import type { AppState } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import type { WorkingDocument, WorkingDocumentId } from '@/store/slices/editor/working-document'
import { createEditorPanelDocumentSelector } from './editor-panel-document-selector'

function makeFile(id: string, overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    id,
    filePath: `/repo/${id}.ts`,
    relativePath: `${id}.ts`,
    worktreeId: 'worktree-1',
    language: 'typescript',
    mode: 'edit',
    isDirty: false,
    ...overrides
  }
}

function documentFor(tabId: string, content: string): WorkingDocument {
  return {
    id: tabId as WorkingDocumentId,
    target: {
      owner: { executionHostId: 'local', runtimeEnvironmentId: null },
      filePath: `/repo/${tabId}.ts`,
      worktreeId: 'worktree-1',
      relativePath: `${tabId}.ts`,
      language: 'typescript',
      operationProvenance: {} as WorkingDocument['target']['operationProvenance']
    },
    content,
    revision: 1,
    isDirty: true,
    loadState: 'ready',
    writable: true,
    alwaysAutoSave: false
  }
}

function stateFor(contents: Record<string, string>) {
  const workingDocuments = {} as Record<WorkingDocumentId, WorkingDocument>
  const workingDocumentIdsByTab: Record<string, readonly WorkingDocumentId[]> = {}
  for (const [tabId, content] of Object.entries(contents)) {
    const document = documentFor(tabId, content)
    workingDocuments[document.id] = document
    workingDocumentIdsByTab[tabId] = [document.id]
  }
  return { workingDocuments, workingDocumentIdsByTab, unifiedTabsByWorktree: {} }
}

describe('createEditorPanelDocumentSelector', () => {
  it('limits canonical-content invalidations to the panel that owns each edit', () => {
    const files = Array.from({ length: 200 }, (_, index) => makeFile(`file-${index}`))
    let state = stateFor({})
    let unrelatedPanelInvalidations = 0
    const selectors = files.map(createEditorPanelDocumentSelector)
    const previousSelections = selectors.map((selector) => selector(state))

    for (let edit = 0; edit < 200; edit += 1) {
      const document = documentFor('file-0', `edit-${edit}`)
      state = {
        workingDocuments: { ...state.workingDocuments, [document.id]: document },
        workingDocumentIdsByTab: {
          ...state.workingDocumentIdsByTab,
          'file-0': [document.id]
        },
        unifiedTabsByWorktree: state.unifiedTabsByWorktree
      }
      for (let panelIndex = 0; panelIndex < files.length; panelIndex += 1) {
        const nextSelection = selectors[panelIndex]!(state)
        if (nextSelection !== previousSelections[panelIndex] && panelIndex !== 0) {
          unrelatedPanelInvalidations += 1
        }
        previousSelections[panelIndex] = nextSelection
      }
    }

    expect(unrelatedPanelInvalidations).toBe(0)
  })

  it('projects preview and selected conflict content from their retained tabs', () => {
    const preview = makeFile('preview', { markdownPreviewSourceFileId: 'source' })
    const conflictReview = makeFile('review', {
      mode: 'conflict-review',
      conflictReview: { selectedFileId: 'selected' } as NonNullable<OpenFile['conflictReview']>
    })
    const state = stateFor({
      preview: 'preview content',
      source: '',
      review: 'review content',
      selected: 'selected content',
      unrelated: 'other content'
    })

    expect(createEditorPanelDocumentSelector(preview)(state)).toEqual({
      preview: 'preview content',
      source: ''
    })
    expect(createEditorPanelDocumentSelector(conflictReview)(state)).toEqual({
      review: 'review content',
      selected: 'selected content'
    })
    expect(createEditorPanelDocumentSelector(null)(state)).toEqual({})
  })
  it('resolves canonical content through a unified tab entity identity', () => {
    const active = makeFile('file-entity')
    const document = documentFor('unified-view', 'shared content')
    const state = {
      workingDocuments: { [document.id]: document },
      workingDocumentIdsByTab: { 'unified-view': [document.id] },
      unifiedTabsByWorktree: {
        'worktree-1': [{ id: 'unified-view', entityId: active.id }]
      } as unknown as AppState['unifiedTabsByWorktree']
    }

    expect(createEditorPanelDocumentSelector(active)(state)).toEqual({
      [active.id]: 'shared content'
    })
  })

  it('keeps its projection when unrelated document records change', () => {
    const activeFile = makeFile('active')
    const selector = createEditorPanelDocumentSelector(activeFile)
    const state = stateFor({ active: 'draft', unrelated: 'other' })
    const selection = selector(state)
    const unrelated = documentFor('unrelated', 'changed elsewhere')

    expect(
      selector({
        workingDocuments: { ...state.workingDocuments, [unrelated.id]: unrelated },
        workingDocumentIdsByTab: state.workingDocumentIdsByTab,
        unifiedTabsByWorktree: state.unifiedTabsByWorktree
      })
    ).toBe(selection)
  })
})
