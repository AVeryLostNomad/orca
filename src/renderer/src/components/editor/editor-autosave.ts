import {
  DEFAULT_EDITOR_AUTO_SAVE_DELAY_MS,
  MAX_EDITOR_AUTO_SAVE_DELAY_MS,
  MIN_EDITOR_AUTO_SAVE_DELAY_MS
} from '../../../../shared/constants'
import type {
  WorkingDocument,
  WorkingDocumentId,
  WorkingDocumentOwner
} from '@/store/slices/editor/working-document'
import { clampNumber } from '@/lib/terminal-theme'

export const ORCA_EDITOR_QUIESCE_DOCUMENT_SAVE_EVENT = 'orca:editor-quiesce-document-save'
export const ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT = 'orca:editor-external-file-change'
export const ORCA_EDITOR_REQUEST_DOCUMENT_SAVE_EVENT = 'orca:editor-request-document-save'
export const ORCA_EDITOR_DOCUMENT_SAVED_EVENT = 'orca:editor-document-saved'
export const ORCA_EDITOR_REQUEST_CMD_SAVE_EVENT = 'orca:editor-request-cmd-save'
export const ORCA_EDITOR_REQUEST_TAB_CLOSE_EVENT = 'orca:editor-request-tab-close'

export type EditorPathMutationTarget = {
  worktreeId: string
  worktreePath: string
  relativePath: string
  runtimeEnvironmentId?: string | null
  allowLocalWindowsWslAliases?: true
}

export type EditorDocumentSaveTarget = {
  documentId: WorkingDocumentId
}

export type EditorDocumentSaveDetail = EditorDocumentSaveTarget & {
  claim: () => void
  resolve: () => void
  reject: (message: string) => void
}

export type EditorDocumentSaveQuiesceDetail = EditorDocumentSaveTarget & {
  claim: () => void
  resolve: () => void
}

export type EditorDocumentSavedDetail = {
  documentId: WorkingDocumentId
  owner: WorkingDocumentOwner
  filePath: string
  content: string
}

export type EditorRequestTabCloseDetail = {
  tabId: string
}

export type EditorRequestCmdSaveDetail = {
  tabId: string
}

export function canAutoSaveWorkingDocument(document: WorkingDocument): boolean {
  return document.writable && document.loadState === 'ready' && document.content !== undefined
}

// Explicit saves can overwrite a reviewed conflict, but background saves must
// wait until every external/disk/owner gate has been resolved.
export function isAutosaveSuspendedForWorkingDocument(
  document: Pick<
    WorkingDocument,
    | 'externalMutation'
    | 'pendingDiskBaselineVerification'
    | 'pendingLiveDiskVerification'
    | 'pendingOwnerMigration'
  >
): boolean {
  return (
    document.externalMutation === 'changed' ||
    document.pendingDiskBaselineVerification === true ||
    document.pendingLiveDiskVerification === true ||
    document.pendingOwnerMigration === true
  )
}

export function normalizeAutoSaveDelayMs(value: unknown): number {
  const numericValue =
    typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : null
  const normalizedValue =
    numericValue !== null && Number.isFinite(numericValue)
      ? numericValue
      : DEFAULT_EDITOR_AUTO_SAVE_DELAY_MS
  return clampNumber(normalizedValue, MIN_EDITOR_AUTO_SAVE_DELAY_MS, MAX_EDITOR_AUTO_SAVE_DELAY_MS)
}

export function getWorkingDocumentsForExternalFileChange(
  workingDocuments: Record<WorkingDocumentId, WorkingDocument>,
  target: EditorPathMutationTarget
): WorkingDocument[] {
  const runtimeEnvironmentId = target.runtimeEnvironmentId?.trim() || null
  return Object.values(workingDocuments).filter(
    (document) =>
      document.target.worktreeId === target.worktreeId &&
      document.target.relativePath === target.relativePath &&
      document.target.owner.runtimeEnvironmentId === runtimeEnvironmentId
  )
}

export async function requestEditorDocumentSave(target: EditorDocumentSaveTarget): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let claimed = false
    window.dispatchEvent(
      new CustomEvent<EditorDocumentSaveDetail>(ORCA_EDITOR_REQUEST_DOCUMENT_SAVE_EVENT, {
        detail: {
          ...target,
          claim: () => {
            claimed = true
          },
          resolve,
          reject: (message) => reject(new Error(message))
        }
      })
    )
    if (!claimed) {
      reject(new Error('Editor save controller is unavailable.'))
    }
  })
}

export async function quiesceDocumentSave(documentId: WorkingDocumentId): Promise<void> {
  await new Promise<void>((resolve) => {
    let claimed = false
    window.dispatchEvent(
      new CustomEvent<EditorDocumentSaveQuiesceDetail>(ORCA_EDITOR_QUIESCE_DOCUMENT_SAVE_EVENT, {
        detail: {
          documentId,
          claim: () => {
            claimed = true
          },
          resolve
        }
      })
    )
    if (!claimed) {
      resolve()
    }
  })
}

export function requestEditorTabClose(tabId: string): void {
  window.dispatchEvent(
    new CustomEvent<EditorRequestTabCloseDetail>(ORCA_EDITOR_REQUEST_TAB_CLOSE_EVENT, {
      detail: { tabId }
    })
  )
}

// Existing reload consumers remain tab/surface oriented. Document ownership is
// resolved by the receiver from the target owner/path, never from selected UI.
export function notifyEditorExternalFileChange(target: EditorPathMutationTarget): void {
  window.dispatchEvent(
    new CustomEvent<EditorPathMutationTarget>(ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT, {
      detail: target
    })
  )
}
