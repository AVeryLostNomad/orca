import type { AppState } from '../../types'
import {
  assertEditorFileOperationCurrent,
  captureEditorFileOperationProvenance,
  type EditorFileOperationProvenance
} from '@/lib/editor-file-operation-owner'
import { isLocalWindowsDesktopClient } from '@/lib/desktop-window-chrome'
import { areLocalWindowsWslPathAliases } from '../../../../../shared/cross-platform-path'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import type { OpenFile } from './types/open-file'
export type WorkingDocumentId = string & { readonly __workingDocumentId: unique symbol }

export type WorkingDocumentOwner = {
  executionHostId: ExecutionHostId
  runtimeEnvironmentId: string | null
}

export type WorkingDocumentTarget = {
  owner: WorkingDocumentOwner
  filePath: string
  worktreeId: string
  relativePath: string
  language: string
  externalSshTargetId?: string
  operationProvenance: EditorFileOperationProvenance
}

export type WorkingDocument = {
  id: WorkingDocumentId
  target: WorkingDocumentTarget
  content: string | undefined
  revision: number
  lastKnownDiskSignature?: string
  isDirty: boolean
  loadState: 'unloaded' | 'loading' | 'ready' | 'error'
  loadError?: string
  writable: boolean
  externalMutation?: 'deleted' | 'renamed' | 'changed'
  pendingDiskBaselineVerification?: boolean
  pendingLiveDiskVerification?: boolean
  pendingOwnerMigration?: boolean
  pendingSelfMoveEcho?: { operationId: string; targetPath: string }
  alwaysAutoSave: boolean
}

export type WorkingDocumentExternalStatePatch = Pick<
  WorkingDocument,
  | 'externalMutation'
  | 'pendingDiskBaselineVerification'
  | 'pendingLiveDiskVerification'
  | 'pendingOwnerMigration'
  | 'pendingSelfMoveEcho'
>

/**
 * File paths have already been admitted by their owning file-operation route. Deliberately retain
 * that spelling: POSIX case, symlinks, and SSH paths must not be normalized as local filesystem
 * paths. Local Windows/WSL aliases are resolved before document retention.
 */
export function canonicalWorkingDocumentPath(filePath: string): string {
  return filePath
}

export function getWorkingDocumentId(
  owner: WorkingDocumentOwner,
  filePath: string
): WorkingDocumentId {
  return JSON.stringify([
    owner.executionHostId,
    owner.runtimeEnvironmentId,
    canonicalWorkingDocumentPath(filePath)
  ]) as WorkingDocumentId
}

export function getWorkingDocumentOwner(
  operationProvenance: EditorFileOperationProvenance
): WorkingDocumentOwner {
  const route = operationProvenance.generation.route
  if (!route.executionHostId) {
    throw new Error("Couldn't verify which host owns this file.")
  }
  return {
    executionHostId: route.executionHostId,
    runtimeEnvironmentId: route.runtimeEnvironmentId
  }
}
/**
 * Captures a route at document admission. This is deliberately the only target constructor
 * allowed to infer provenance; it fails closed rather than silently treating an unresolved
 * remote file as local.
 */
export function buildWorkingDocumentTarget(
  state: AppState,
  file: Pick<
    OpenFile,
    | 'filePath'
    | 'worktreeId'
    | 'relativePath'
    | 'language'
    | 'runtimeEnvironmentId'
    | 'externalSshTargetId'
    | 'operationProvenance'
  >
): WorkingDocumentTarget {
  const operationProvenance =
    file.operationProvenance ??
    captureEditorFileOperationProvenance(
      state,
      file.worktreeId,
      file.runtimeEnvironmentId,
      file.runtimeEnvironmentId !== undefined
    )
  const route = file.operationProvenance
    ? assertEditorFileOperationCurrent(state, file.worktreeId, operationProvenance)
    : operationProvenance.generation.route
  if (!route.executionHostId) {
    throw new Error("Couldn't verify which host owns this file.")
  }
  const owner: WorkingDocumentOwner = {
    executionHostId: route.executionHostId,
    runtimeEnvironmentId: route.runtimeEnvironmentId
  }
  let filePath = canonicalWorkingDocumentPath(file.filePath)
  if (
    isLocalWindowsDesktopClient() &&
    route.executionHostId === 'local' &&
    route.runtimeEnvironmentId === null &&
    !file.externalSshTargetId
  ) {
    const admittedAlias = Object.values(state.workingDocuments).find(
      (document) =>
        document.target.owner.executionHostId === owner.executionHostId &&
        document.target.owner.runtimeEnvironmentId === owner.runtimeEnvironmentId &&
        !document.target.externalSshTargetId &&
        areLocalWindowsWslPathAliases(document.target.filePath, filePath)
    )
    if (admittedAlias) {
      filePath = admittedAlias.target.filePath
    }
  }
  return {
    owner,
    filePath,
    worktreeId: file.worktreeId,
    relativePath: file.relativePath,
    language: file.language,
    ...(file.externalSshTargetId ? { externalSshTargetId: file.externalSshTargetId } : {}),
    operationProvenance
  }
}

/** Projects a target from an already admitted file. Do not use this to admit a new document. */
export function getWorkingDocumentTarget(
  file: Pick<
    OpenFile,
    | 'filePath'
    | 'worktreeId'
    | 'relativePath'
    | 'language'
    | 'externalSshTargetId'
    | 'operationProvenance'
  >
): WorkingDocumentTarget | null {
  if (!file.operationProvenance) {
    return null
  }
  return {
    owner: getWorkingDocumentOwner(file.operationProvenance),
    filePath: canonicalWorkingDocumentPath(file.filePath),
    worktreeId: file.worktreeId,
    relativePath: file.relativePath,
    language: file.language,
    ...(file.externalSshTargetId ? { externalSshTargetId: file.externalSshTargetId } : {}),
    operationProvenance: file.operationProvenance
  }
}

export function isWorkingDocumentWritableFile(file: Pick<OpenFile, 'mode' | 'readOnly'>): boolean {
  return file.mode === 'edit' && file.readOnly !== true
}

export function isWorkingDocumentDiffFile(
  file: Pick<OpenFile, 'mode' | 'diffSource' | 'readOnly'>
): boolean {
  return file.mode === 'diff' && file.diffSource === 'unstaged' && file.readOnly !== true
}

export function isWorkingDocumentFile(
  file: Pick<OpenFile, 'mode' | 'diffSource' | 'readOnly'>
): boolean {
  return isWorkingDocumentWritableFile(file) || isWorkingDocumentDiffFile(file)
}
