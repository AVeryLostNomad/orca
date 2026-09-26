import type { AppState } from '../../types'
import type { EditorSlice } from './types/editor-slice'
import type {
  WorkingDocument,
  WorkingDocumentExternalStatePatch,
  WorkingDocumentId,
  WorkingDocumentTarget
} from './working-document'

export type WorkingDocumentState = {
  workingDocuments: Record<WorkingDocumentId, WorkingDocument>
  workingDocumentIdsByTab: Record<string, readonly WorkingDocumentId[]>
  retainWorkingDocument: (tabId: string, target: WorkingDocumentTarget) => WorkingDocumentId
  setWorkingDocumentLoadState: (
    id: WorkingDocumentId,
    expectedRevision: number,
    loadState: 'loading' | 'error',
    loadError?: string
  ) => void
  acceptWorkingDocumentLoad: (
    id: WorkingDocumentId,
    expectedRevision: number,
    content: string,
    diskSignature: string | undefined
  ) => void
  discardWorkingDocumentEdits: (
    id: WorkingDocumentId,
    content: string,
    diskSignature: string | undefined
  ) => void
  setWorkingDocumentDiskBaseline: (id: WorkingDocumentId, diskSignature: string | undefined) => void
  setWorkingDocumentContent: (id: WorkingDocumentId, content: string) => void
  commitWorkingDocumentSave: (
    id: WorkingDocumentId,
    savedContent: string,
    savedSignature: string | undefined
  ) => void
  setWorkingDocumentExternalState: (
    id: WorkingDocumentId,
    patch: WorkingDocumentExternalStatePatch
  ) => void
  releaseWorkingDocumentsForTab: (tabId: string) => void
  /** Final close discard after save quiescence. Shared documents remain untouched until their last owner releases. */
  discardWorkingDocument: (id: WorkingDocumentId) => void
}

export function getWorkingDocumentIdsForTab(
  state: Pick<WorkingDocumentState, 'workingDocumentIdsByTab'>,
  tabId: string
): readonly WorkingDocumentId[] {
  return state.workingDocumentIdsByTab[tabId] ?? []
}

export function getWorkingDocumentForTab(
  state: Pick<WorkingDocumentState, 'workingDocuments' | 'workingDocumentIdsByTab'>,
  tabId: string
): WorkingDocument | undefined {
  const id = state.workingDocumentIdsByTab[tabId]?.[0]
  return id ? state.workingDocuments[id] : undefined
}

export function getWorkingDocumentForFile(
  state: Pick<AppState, 'workingDocuments' | 'workingDocumentIdsByTab' | 'unifiedTabsByWorktree'>,
  fileId: string
): WorkingDocument | undefined {
  const direct = getWorkingDocumentForTab(state, fileId)
  if (direct) {
    return direct
  }
  for (const worktreeId in state.unifiedTabsByWorktree) {
    for (const tab of state.unifiedTabsByWorktree[worktreeId]) {
      if (tab.entityId !== fileId) {
        continue
      }
      const document = getWorkingDocumentForTab(state, tab.id)
      if (document) {
        return document
      }
    }
  }
  return undefined
}
export function getEditorClosePlan(
  state: Pick<AppState, 'workingDocuments' | 'workingDocumentIdsByTab' | 'unifiedTabsByWorktree'>,
  tabIds: readonly string[]
): { tabIds: readonly string[]; dirtyDocumentIds: readonly WorkingDocumentId[] } {
  const unifiedTabs = Object.values(state.unifiedTabsByWorktree ?? {}).flat()
  const closingTabs = new Set<string>()
  for (const requestedTabId of tabIds) {
    const matchingSurfaces = unifiedTabs.filter((tab) => tab.entityId === requestedTabId)
    if (matchingSurfaces.length > 0) {
      for (const tab of matchingSurfaces) {
        closingTabs.add(tab.id)
      }
    } else {
      closingTabs.add(requestedTabId)
    }
  }
  const documentIds = new Set<WorkingDocumentId>()
  for (const tabId of closingTabs) {
    for (const id of state.workingDocumentIdsByTab[tabId] ?? []) {
      documentIds.add(id)
    }
  }
  const dirtyDocumentIds = [...documentIds].filter(
    (id) =>
      state.workingDocuments[id]?.isDirty === true &&
      Object.entries(state.workingDocumentIdsByTab).every(
        ([tabId, ids]) => !ids.includes(id) || closingTabs.has(tabId)
      )
  )
  return { tabIds: [...closingTabs], dirtyDocumentIds }
}

export function projectDirtyBadges(
  state: Pick<
    AppState,
    'openFiles' | 'workingDocumentIdsByTab' | 'workingDocuments' | 'unifiedTabsByWorktree'
  >
): EditorSlice['openFiles'] {
  const dirtyByTab = new Map<string, boolean>()
  for (const [tabId, ids] of Object.entries(state.workingDocumentIdsByTab)) {
    dirtyByTab.set(
      tabId,
      ids.some((id) => state.workingDocuments[id]?.isDirty === true)
    )
  }
  return state.openFiles.map((file) => {
    const dirty =
      dirtyByTab.get(file.id) ??
      Object.values(state.unifiedTabsByWorktree ?? {}).some((tabs) =>
        tabs.some((tab) => tab.entityId === file.id && dirtyByTab.get(tab.id) === true)
      )
    const isPreview = dirty && file.isPreview ? undefined : file.isPreview
    return file.isDirty === dirty && file.isPreview === isPreview
      ? file
      : { ...file, isDirty: dirty, isPreview }
  })
}

export function promoteDirtyDocumentPreviewTabs(
  state: Pick<AppState, 'workingDocumentIdsByTab' | 'unifiedTabsByWorktree'>,
  documentId: WorkingDocumentId
): AppState['unifiedTabsByWorktree'] {
  let unifiedTabsByWorktree: AppState['unifiedTabsByWorktree'] | undefined
  for (const [worktreeId, tabs] of Object.entries(state.unifiedTabsByWorktree ?? {})) {
    if (
      !tabs.some(
        (tab) => tab.isPreview && state.workingDocumentIdsByTab[tab.id]?.includes(documentId)
      )
    ) {
      continue
    }
    unifiedTabsByWorktree ??= { ...state.unifiedTabsByWorktree }
    unifiedTabsByWorktree[worktreeId] = tabs.map((tab) =>
      tab.isPreview && state.workingDocumentIdsByTab[tab.id]?.includes(documentId)
        ? { ...tab, isPreview: false }
        : tab
    )
  }
  return unifiedTabsByWorktree ?? state.unifiedTabsByWorktree
}
