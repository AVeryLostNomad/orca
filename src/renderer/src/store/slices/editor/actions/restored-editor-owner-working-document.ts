import type { AppState } from '../../../types'
import type { EditorFileOperationProvenance } from '@/lib/editor-file-operation-owner'
import type { OpenFile } from '../types/open-file'
import {
  getWorkingDocumentId,
  getWorkingDocumentOwner,
  type WorkingDocumentId
} from '../working-document'

type WorkingDocumentPatch = Pick<AppState, 'workingDocuments' | 'workingDocumentIdsByTab'>

/** Carries the source tab's working document onto its new owner; null when a dirty destination would be overwritten. */
export function migrateRestoredEditorWorkingDocument(
  s: Pick<AppState, 'workingDocuments' | 'workingDocumentIdsByTab' | 'unifiedTabsByWorktree'>,
  source: OpenFile,
  /** Old view id (file or tab) to its id after the move. */
  viewIdMigrations: ReadonlyMap<string, string>,
  target: {
    worktreeId: string
    relativePath: string
    externalSshTargetId: string | undefined
    operationProvenance: EditorFileOperationProvenance
  }
): WorkingDocumentPatch | null {
  const sourceTabIds = [
    source.id,
    ...(s.unifiedTabsByWorktree[source.worktreeId] ?? [])
      .filter((tab) => tab.entityId === source.id)
      .map((tab) => tab.id)
  ]
  const sourceDocumentId = sourceTabIds
    .flatMap((tabId) => s.workingDocumentIdsByTab[tabId] ?? [])
    .find((documentId) => s.workingDocuments[documentId]?.target.filePath === source.filePath)
  const sourceDocument = sourceDocumentId ? s.workingDocuments[sourceDocumentId] : undefined
  const targetOwner = getWorkingDocumentOwner(target.operationProvenance)
  const targetDocumentId = sourceDocument
    ? getWorkingDocumentId(targetOwner, sourceDocument.target.filePath)
    : undefined
  const destinationDocument = targetDocumentId ? s.workingDocuments[targetDocumentId] : undefined
  if (
    sourceDocument &&
    destinationDocument &&
    sourceDocumentId !== targetDocumentId &&
    (sourceDocument.isDirty || destinationDocument.isDirty)
  ) {
    return null
  }
  const workingDocuments = { ...s.workingDocuments }
  if (sourceDocument && sourceDocumentId && targetDocumentId) {
    if (sourceDocumentId !== targetDocumentId) {
      delete workingDocuments[sourceDocumentId]
    }
    if (!destinationDocument || sourceDocumentId === targetDocumentId) {
      workingDocuments[targetDocumentId] = {
        ...sourceDocument,
        id: targetDocumentId,
        target: {
          ...sourceDocument.target,
          owner: targetOwner,
          worktreeId: target.worktreeId,
          relativePath: target.relativePath,
          externalSshTargetId: target.externalSshTargetId,
          operationProvenance: target.operationProvenance
        },
        pendingOwnerMigration: undefined
      }
    }
  }
  const workingDocumentIdsByTab = Object.entries(s.workingDocumentIdsByTab).reduce(
    (memberships, [tabId, documentIds]) => {
      const nextTabId = viewIdMigrations.get(tabId) ?? tabId
      const nextDocumentIds =
        sourceDocumentId && targetDocumentId
          ? documentIds.map((id) => (id === sourceDocumentId ? targetDocumentId : id))
          : documentIds
      memberships[nextTabId] = [...new Set([...(memberships[nextTabId] ?? []), ...nextDocumentIds])]
      return memberships
    },
    {} as Record<string, readonly WorkingDocumentId[]>
  )
  return { workingDocuments, workingDocumentIdsByTab }
}
