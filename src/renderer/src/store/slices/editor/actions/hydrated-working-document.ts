import type { AppState } from '../../../types'
import type { EditorFileOperationProvenance } from '@/lib/editor-file-operation-owner'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import type { OpenFile } from '../types/open-file'
import {
  buildWorkingDocumentTarget,
  getWorkingDocumentId,
  type WorkingDocument,
  type WorkingDocumentTarget
} from '../working-document'

type PersistedDocumentOwner = {
  executionHostId?: ExecutionHostId
  runtimeEnvironmentId?: string | null
}

function unresolvedHydratedDocumentTarget(
  file: OpenFile,
  persisted: PersistedDocumentOwner
): WorkingDocumentTarget {
  const persistedRuntimeEnvironmentId = persisted.runtimeEnvironmentId?.trim() || null
  const runtimeEnvironmentId =
    persistedRuntimeEnvironmentId ??
    (persisted.executionHostId === undefined ? 'unresolved-editor-session-owner' : null)
  const executionHostId =
    persisted.executionHostId ??
    (`runtime:${encodeURIComponent(runtimeEnvironmentId!)}` as ExecutionHostId)
  const operationProvenance: EditorFileOperationProvenance = {
    generation: {
      route: { executionHostId, runtimeEnvironmentId },
      runtimeConnectionGeneration: null,
      runtimePairingRevision: undefined,
      runtimeSshGeneration: null,
      nestedSshGeneration: null,
      directSshGeneration: null
    },
    ownershipProjection: 'legacy'
  }
  return {
    owner: { executionHostId, runtimeEnvironmentId },
    filePath: file.filePath,
    relativePath: file.relativePath,
    worktreeId: file.worktreeId,
    language: file.language,
    ...(file.externalSshTargetId ? { externalSshTargetId: file.externalSshTargetId } : {}),
    operationProvenance
  }
}

type PersistedDirtyDocument = PersistedDocumentOwner & {
  dirtyDraftContent: string
  lastKnownDiskSignature?: string
  alwaysAutoSave?: boolean
}

export type HydratedWorkingDocumentResolver = (
  file: OpenFile,
  persisted: PersistedDirtyDocument
) => { document: WorkingDocument; operationProvenance?: EditorFileOperationProvenance }

/** The restored dirty document for `file`; an owner that no current route confirms blocks every operation until it resolves. */
export function buildHydratedWorkingDocument(
  state: AppState | undefined,
  file: OpenFile,
  persisted: PersistedDirtyDocument
): { document: WorkingDocument; operationProvenance?: EditorFileOperationProvenance } {
  let target: WorkingDocumentTarget
  let ownerNeedsResolution = false
  try {
    if (!state) {
      throw new Error('no store to resolve the owner')
    }
    target = buildWorkingDocumentTarget(state, file)
    if (
      persisted.executionHostId !== undefined &&
      target.owner.executionHostId !== persisted.executionHostId
    ) {
      target = unresolvedHydratedDocumentTarget(file, persisted)
      ownerNeedsResolution = true
    }
  } catch {
    target = unresolvedHydratedDocumentTarget(file, persisted)
    ownerNeedsResolution = true
  }
  return {
    document: {
      id: getWorkingDocumentId(target.owner, target.filePath),
      target,
      content: persisted.dirtyDraftContent,
      revision: 1,
      ...(persisted.lastKnownDiskSignature === undefined
        ? {}
        : { lastKnownDiskSignature: persisted.lastKnownDiskSignature }),
      isDirty: true,
      loadState: 'ready',
      writable: true,
      // A restored dirty document never autosaves before disk review; a missing signature is itself a review condition.
      pendingDiskBaselineVerification: true,
      ...(ownerNeedsResolution ? { pendingOwnerMigration: true } : {}),
      alwaysAutoSave: persisted.alwaysAutoSave === true
    },
    ...(ownerNeedsResolution ? {} : { operationProvenance: target.operationProvenance })
  }
}
