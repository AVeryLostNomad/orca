import type { AppState } from '@/store/types'
import { getWorkingDocumentId, type WorkingDocument } from '@/store/slices/editor/working-document'
import { assertEditorFileOperationCurrent } from '@/lib/editor-file-operation-owner'
import {
  getFileExplorerDeletionEditors,
  type FileExplorerDeletionEditor
} from './file-explorer-deletion-editors'
import type { FileExplorerOperationRoute } from './file-explorer-operation-owner'

/** Present a working document in the tab shape the deletion owner filter reads. */
function toDeletionEditor(document: WorkingDocument): FileExplorerDeletionEditor {
  return {
    id: document.id,
    filePath: document.target.filePath,
    worktreeId: document.target.worktreeId,
    isDirty: document.isDirty,
    runtimeEnvironmentId: document.target.owner.runtimeEnvironmentId,
    externalSshTargetId: document.target.externalSshTargetId,
    operationProvenance: document.target.operationProvenance
  }
}

/** Owner-matched documents under the path, plus each owner-verified tab's own document
 *  (a document shared across workspaces carries only its first opener's provenance). */
export function getDeletionDocuments(
  state: AppState,
  tabsToClose: readonly FileExplorerDeletionEditor[],
  deletedPath: string,
  route: FileExplorerOperationRoute
): WorkingDocument[] {
  const ownerMatchedIds = new Set(
    getFileExplorerDeletionEditors(
      state,
      Object.values(state.workingDocuments).map(toDeletionEditor),
      deletedPath,
      route
    ).map((document) => document.id)
  )
  const byId = new Map(
    Object.values(state.workingDocuments)
      .filter((document) => ownerMatchedIds.has(document.id))
      .map((document) => [document.id, document])
  )
  for (const tab of tabsToClose) {
    if (!tab.operationProvenance) {
      continue
    }
    try {
      const tabRoute = assertEditorFileOperationCurrent(
        state,
        tab.worktreeId,
        tab.operationProvenance
      )
      if (!tabRoute.executionHostId) {
        continue
      }
      const owner = {
        executionHostId: tabRoute.executionHostId,
        runtimeEnvironmentId: tabRoute.runtimeEnvironmentId
      }
      const document = state.workingDocuments[getWorkingDocumentId(owner, tab.filePath)]
      if (document && !byId.has(document.id)) {
        byId.set(document.id, document)
      }
    } catch {
      // A tab whose owner can't be verified names no document.
    }
  }
  return [...byId.values()]
}
