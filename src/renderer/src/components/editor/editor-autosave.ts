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
import type { OpenFile } from '@/store/slices/editor'
import { resolveEditorOwnerRoute } from '@/lib/editor-file-operation-owner'
import type { WorktreeOperationRouteState } from '@/lib/worktree-operation-route'
import { joinPath } from '@/lib/path'
import { isLocalWindowsDesktopClient } from '@/lib/desktop-window-chrome'
import { externalChangePathKeyFor } from './external-change-path-key'
import { areLocalWindowsWslPathAliases } from '../../../../shared/cross-platform-path'
import { isAutosavePausedForNonUtf8File } from './editor-non-utf8-autosave-pause'

export const ORCA_EDITOR_QUIESCE_DOCUMENT_SAVE_EVENT = 'orca:editor-quiesce-document-save'
export const ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT = 'orca:editor-external-file-change'
export const ORCA_EDITOR_REQUEST_DOCUMENT_SAVE_EVENT = 'orca:editor-request-document-save'
export const ORCA_EDITOR_DOCUMENT_SAVED_EVENT = 'orca:editor-document-saved'
export const ORCA_EDITOR_REQUEST_CMD_SAVE_EVENT = 'orca:editor-request-cmd-save'
export const ORCA_EDITOR_REQUEST_TAB_CLOSE_EVENT = 'orca:editor-request-tab-close'
/** File-keyed close requests share the tab event; the close queue maps a file id to its tabs. */
export const ORCA_EDITOR_REQUEST_FILE_CLOSE_EVENT = ORCA_EDITOR_REQUEST_TAB_CLOSE_EVENT

export type EditorPathMutationTarget = {
  worktreeId: string
  worktreePath: string
  relativePath: string
  runtimeEnvironmentId?: string | null
  allowLocalWindowsWslAliases?: true
}

export type EditorDocumentSaveTarget = {
  documentId: WorkingDocumentId
  /** Only the conflict banner's Overwrite sets this. */
  overwrite?: true
  /** Only the user's confirmation to replace a non-UTF-8 file's unreadable characters sets this. */
  convertToUtf8?: true
}

export type EditorDocumentSaveDetail = EditorDocumentSaveTarget & {
  claim: () => void
  resolve: () => void
  reject: (message: string) => void
}

export type EditorDocumentSaveQuiesceDetail = EditorDocumentSaveTarget & {
  claim: () => void
  resolve: () => void
  /** Receives the release for an autosave hold taken after the quiesce settles. */
  onHold?: (release: () => void) => void
  /** A pending producer refused to commit (e.g. an unresolved CSV cell); no hold is kept. */
  reject?: (message: string) => void
}

export type EditorDocumentSavedDetail = {
  documentId: WorkingDocumentId
  owner: WorkingDocumentOwner
  filePath: string
  content: string
}

export type EditorRequestTabCloseDetail = {
  tabId: string
  /** Runs once the tab actually closes — after save or discard, never on cancel. */
  onClosed?: () => void
}

export type EditorRequestCmdSaveDetail = {
  tabId: string
}

export function isExternalReloadableEditorTab(file: OpenFile): boolean {
  return (
    file.mode === 'edit' ||
    file.mode === 'markdown-preview' ||
    (file.mode === 'diff' && (file.diffSource === 'unstaged' || file.diffSource === 'staged'))
  )
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
  > & { target?: WorkingDocument['target'] }
): boolean {
  return (
    document.externalMutation === 'changed' ||
    document.pendingDiskBaselineVerification === true ||
    document.pendingLiveDiskVerification === true ||
    document.pendingOwnerMigration === true ||
    (document.target !== undefined &&
      isAutosavePausedForNonUtf8File({
        filePath: document.target.filePath,
        runtimeEnvironmentId: document.target.owner.runtimeEnvironmentId
      }))
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
  target: EditorPathMutationTarget,
  /** The changed workspace's execution host; lets other workspaces' views of the file match. */
  targetExecutionHostId?: string | null
): WorkingDocument[] {
  const runtimeEnvironmentId = target.runtimeEnvironmentId?.trim() || null
  const absolutePath = joinPath(target.worktreePath, target.relativePath)
  // Why: Windows roots fold drive/separator spellings so watcher paths still match open documents.
  const pathKey = externalChangePathKeyFor(target.worktreePath)
  const absolutePathKey = pathKey(absolutePath)
  return Object.values(workingDocuments).filter((document) => {
    if ((document.target.owner.runtimeEnvironmentId ?? null) !== runtimeEnvironmentId) {
      return false
    }
    // A document is shared by every workspace's view; only the same host may match by path.
    const sameScope =
      document.target.worktreeId === target.worktreeId ||
      (targetExecutionHostId != null &&
        document.target.owner.executionHostId === targetExecutionHostId)
    if (!sameScope) {
      return false
    }
    return (
      document.target.relativePath === target.relativePath ||
      pathKey(document.target.filePath) === absolutePathKey ||
      (target.allowLocalWindowsWslAliases === true &&
        isLocalWindowsDesktopClient() &&
        areLocalWindowsWslPathAliases(document.target.filePath, absolutePath))
    )
  })
}

/** The changed workspace's execution host, so other workspaces' views of the file also match. */
export function getExternalChangeExecutionHostId(
  state: WorktreeOperationRouteState,
  worktreeId: string
): string | null {
  try {
    const owner = resolveEditorOwnerRoute(state, worktreeId)
    return owner.kind === 'resolved' ? owner.route.executionHostId : null
  } catch {
    return null
  }
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

/** Quiesce, then hold autosave of the document until the returned release runs (e.g. after a git discard). */
export async function holdDocumentAutosave(documentId: WorkingDocumentId): Promise<() => void> {
  let release = (): void => {}
  await new Promise<void>((resolve, reject) => {
    let claimed = false
    window.dispatchEvent(
      new CustomEvent<EditorDocumentSaveQuiesceDetail>(ORCA_EDITOR_QUIESCE_DOCUMENT_SAVE_EVENT, {
        detail: {
          documentId,
          claim: () => {
            claimed = true
          },
          resolve,
          reject: (message) => reject(new Error(message)),
          onHold: (hold) => {
            release = hold
          }
        }
      })
    )
    if (!claimed) {
      resolve()
    }
  })
  return release
}

export function requestEditorTabClose(
  tabId: string,
  options?: Pick<EditorRequestTabCloseDetail, 'onClosed'>
): void {
  window.dispatchEvent(
    new CustomEvent<EditorRequestTabCloseDetail>(ORCA_EDITOR_REQUEST_TAB_CLOSE_EVENT, {
      detail: { tabId, ...options }
    })
  )
}

/** The close queue resolves a file id to its unified tabs, so file-keyed callers share the tab event. */
export const requestEditorFileClose = requestEditorTabClose

// Existing reload consumers remain tab/surface oriented. Document ownership is
// resolved by the receiver from the target owner/path, never from selected UI.
const externalFileChangeGenerations = new WeakMap<Event, number>()
let externalFileChangeGenerationCounter = 0

// Why: every listener of one change event shares a generation so their forced reads coalesce.
export function getEditorExternalFileChangeGeneration(event: Event): number {
  const existing = externalFileChangeGenerations.get(event)
  if (existing !== undefined) {
    return existing
  }
  const generation = ++externalFileChangeGenerationCounter
  externalFileChangeGenerations.set(event, generation)
  return generation
}

export function notifyEditorExternalFileChange(target: EditorPathMutationTarget): void {
  window.dispatchEvent(
    new CustomEvent<EditorPathMutationTarget>(ORCA_EDITOR_EXTERNAL_FILE_CHANGE_EVENT, {
      detail: target
    })
  )
}
