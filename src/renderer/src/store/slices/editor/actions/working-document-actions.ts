import { getDiskBaselineSignature } from '@/components/editor/diff-content-signature'
import type { EditorGet, EditorSet } from '../types/editor-set-get'
import {
  getWorkingDocumentId,
  type WorkingDocument,
  type WorkingDocumentId
} from '../working-document'
import {
  projectDirtyBadges,
  promoteDirtyDocumentPreviewTabs,
  type WorkingDocumentState
} from '../working-document-state'

function removeWorkingDocumentIfUnretained(
  documents: Record<WorkingDocumentId, WorkingDocument>,
  memberships: Record<string, readonly WorkingDocumentId[]>,
  id: WorkingDocumentId
): Record<WorkingDocumentId, WorkingDocument> {
  if (Object.values(memberships).some((ids) => ids.includes(id)) || documents[id]?.isDirty) {
    return documents
  }
  const { [id]: _discarded, ...remaining } = documents
  return remaining
}

export function createWorkingDocumentState(set: EditorSet, _get: EditorGet): WorkingDocumentState {
  return {
    workingDocuments: {},
    workingDocumentIdsByTab: {},
    retainWorkingDocument: (tabId, target) => {
      const id = getWorkingDocumentId(target.owner, target.filePath)
      set((state) => {
        const currentIds = state.workingDocumentIdsByTab[tabId] ?? []
        const hasMembership = currentIds.includes(id)
        const current = state.workingDocuments[id]
        const newlyRetainedAlwaysAutoSave = state.openFiles.some(
          (file) =>
            file.alwaysAutoSave === true &&
            (file.id === tabId ||
              Object.values(state.unifiedTabsByWorktree ?? {}).some((tabs) =>
                tabs.some((tab) => tab.id === tabId && tab.entityId === file.id)
              ))
        )
        const workingDocuments = current
          ? {
              ...state.workingDocuments,
              [id]: {
                ...current,
                // Logical identity is owner+path, not workspace/provenance generation. A second
                // retained surface refreshes its operational route without replacing content/undo.
                target,
                alwaysAutoSave: current.alwaysAutoSave || newlyRetainedAlwaysAutoSave
              }
            }
          : {
              ...state.workingDocuments,
              [id]: {
                id,
                target,
                content: undefined,
                revision: 0,
                isDirty: false,
                loadState: 'unloaded',
                writable: false,
                alwaysAutoSave: newlyRetainedAlwaysAutoSave
              }
            }
        const workingDocumentIdsByTab = {
          ...state.workingDocumentIdsByTab,
          [tabId]: hasMembership ? currentIds : [...currentIds, id]
        }
        return {
          workingDocuments,
          workingDocumentIdsByTab,
          openFiles: projectDirtyBadges({
            ...state,
            workingDocuments,
            workingDocumentIdsByTab
          })
        }
      })
      return id
    },
    setWorkingDocumentLoadState: (id, expectedRevision, loadState, loadError) =>
      set((state) => {
        const document = state.workingDocuments[id]
        if (!document || document.revision !== expectedRevision || document.isDirty) {
          return state
        }
        return {
          workingDocuments: {
            ...state.workingDocuments,
            [id]: {
              ...document,
              loadState,
              writable: false,
              ...(loadState === 'error' && loadError ? { loadError } : {})
            }
          }
        }
      }),
    acceptWorkingDocumentLoad: (id, expectedRevision, content, diskSignature) =>
      set((state) => {
        const document = state.workingDocuments[id]
        if (!document || document.revision !== expectedRevision || document.isDirty) {
          return state
        }
        const next: WorkingDocument = {
          ...document,
          content,
          revision: document.revision + 1,
          ...(diskSignature === undefined ? {} : { lastKnownDiskSignature: diskSignature }),
          isDirty: false,
          loadState: 'ready',
          loadError: undefined,
          writable: true
        }
        return {
          workingDocuments: { ...state.workingDocuments, [id]: next }
        }
      }),
    discardWorkingDocumentEdits: (id, content, diskSignature) =>
      set((state) => {
        const document = state.workingDocuments[id]
        if (!document) {
          return state
        }
        const workingDocuments = {
          ...state.workingDocuments,
          [id]: {
            ...document,
            content,
            revision: document.revision + 1,
            ...(diskSignature === undefined ? {} : { lastKnownDiskSignature: diskSignature }),
            isDirty: false,
            loadState: 'ready' as const,
            loadError: undefined,
            writable: true,
            externalMutation: undefined,
            pendingDiskBaselineVerification: undefined,
            pendingLiveDiskVerification: undefined
          }
        }
        return {
          workingDocuments,
          openFiles: projectDirtyBadges({ ...state, workingDocuments })
        }
      }),
    setWorkingDocumentDiskBaseline: (id, diskSignature) =>
      set((state) => {
        const document = state.workingDocuments[id]
        if (!document || document.lastKnownDiskSignature === diskSignature) {
          return state
        }
        return {
          workingDocuments: {
            ...state.workingDocuments,
            [id]: {
              ...document,
              ...(diskSignature === undefined
                ? { lastKnownDiskSignature: undefined }
                : { lastKnownDiskSignature: diskSignature })
            }
          }
        }
      }),
    setWorkingDocumentContent: (id, content) =>
      set((state) => {
        const document = state.workingDocuments[id]
        if (
          !document ||
          !document.writable ||
          document.loadState !== 'ready' ||
          document.content === content
        ) {
          return state
        }
        const isDirty =
          document.lastKnownDiskSignature === undefined ||
          getDiskBaselineSignature(content) !== document.lastKnownDiskSignature
        const workingDocuments = {
          ...state.workingDocuments,
          [id]: {
            ...document,
            content,
            revision: document.revision + 1,
            isDirty
          }
        }
        return {
          workingDocuments,
          openFiles: projectDirtyBadges({ ...state, workingDocuments }),
          ...(isDirty ? { unifiedTabsByWorktree: promoteDirtyDocumentPreviewTabs(state, id) } : {})
        }
      }),
    commitWorkingDocumentSave: (id, savedContent, savedSignature) =>
      set((state) => {
        const document = state.workingDocuments[id]
        if (!document) {
          return state
        }
        const hasLaterEdit = document.content !== savedContent
        const next: WorkingDocument = {
          ...document,
          ...(savedSignature === undefined ? {} : { lastKnownDiskSignature: savedSignature }),
          isDirty: hasLaterEdit,
          externalMutation: undefined,
          pendingDiskBaselineVerification: undefined,
          pendingLiveDiskVerification: undefined
        }
        const workingDocuments = { ...state.workingDocuments, [id]: next }
        return {
          workingDocuments,
          openFiles: projectDirtyBadges({ ...state, workingDocuments })
        }
      }),
    setWorkingDocumentExternalState: (id, patch) =>
      set((state) => {
        const document = state.workingDocuments[id]
        if (!document) {
          return state
        }
        const next = { ...document, ...patch }
        if (
          next.externalMutation === document.externalMutation &&
          next.pendingDiskBaselineVerification === document.pendingDiskBaselineVerification &&
          next.pendingLiveDiskVerification === document.pendingLiveDiskVerification &&
          next.pendingOwnerMigration === document.pendingOwnerMigration &&
          next.pendingSelfMoveEcho === document.pendingSelfMoveEcho
        ) {
          return state
        }
        return { workingDocuments: { ...state.workingDocuments, [id]: next } }
      }),
    releaseWorkingDocumentsForTab: (tabId) =>
      set((state) => {
        if (!(tabId in state.workingDocumentIdsByTab)) {
          return state
        }
        const { [tabId]: released, ...workingDocumentIdsByTab } = state.workingDocumentIdsByTab
        let workingDocuments = state.workingDocuments
        for (const id of released) {
          workingDocuments = removeWorkingDocumentIfUnretained(
            workingDocuments,
            workingDocumentIdsByTab,
            id
          )
        }
        return {
          workingDocuments,
          workingDocumentIdsByTab,
          openFiles: projectDirtyBadges({ ...state, workingDocuments, workingDocumentIdsByTab })
        }
      }),
    discardWorkingDocument: (id) =>
      set((state) => {
        const document = state.workingDocuments[id]
        if (!document) {
          return state
        }
        const workingDocuments = {
          ...state.workingDocuments,
          [id]: { ...document, isDirty: false }
        }
        const pruned = removeWorkingDocumentIfUnretained(
          workingDocuments,
          state.workingDocumentIdsByTab,
          id
        )
        return {
          workingDocuments: pruned,
          openFiles: projectDirtyBadges({ ...state, workingDocuments: pruned })
        }
      })
  }
}
