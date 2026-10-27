import type { AppState } from '../../types'
import type { OpenFile } from './types/open-file'
import {
  buildWorkingDocumentTarget,
  getWorkingDocumentId,
  type WorkingDocument,
  type WorkingDocumentId,
  type WorkingDocumentTarget
} from './working-document'
import { getWorkingDocumentForFile } from './working-document-state'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import { getDiskBaselineSignature } from '../../../../../shared/disk-baseline-signature'

type TestStore = { getState: () => AppState; setState: (patch: Partial<AppState>) => void }

/** A test target whose owner is the file's own runtime (or this app), with no provenance lookup. */
export function testWorkingDocumentTarget(
  file: Pick<
    OpenFile,
    | 'filePath'
    | 'relativePath'
    | 'worktreeId'
    | 'language'
    | 'runtimeEnvironmentId'
    | 'externalSshTargetId'
  >
): WorkingDocumentTarget {
  const runtimeEnvironmentId = file.runtimeEnvironmentId?.trim() || null
  const executionHostId = (
    runtimeEnvironmentId
      ? `runtime:${encodeURIComponent(runtimeEnvironmentId)}`
      : file.externalSshTargetId
        ? `ssh:${file.externalSshTargetId}`
        : 'local'
  ) as ExecutionHostId
  return {
    owner: { executionHostId, runtimeEnvironmentId },
    filePath: file.filePath,
    relativePath: file.relativePath,
    worktreeId: file.worktreeId,
    language: file.language,
    ...(file.externalSshTargetId ? { externalSshTargetId: file.externalSshTargetId } : {}),
    operationProvenance: {
      generation: {
        route: { executionHostId, runtimeEnvironmentId },
        runtimeConnectionGeneration: null,
        runtimePairingRevision: undefined,
        runtimeSshGeneration: null,
        nestedSshGeneration: null,
        directSshGeneration: null
      },
      ownershipProjection: 'explicit'
    } as WorkingDocumentTarget['operationProvenance']
  }
}

/** Gives an open file a clean document read from `diskContent`, shared by every tab of it. */
export function loadTestDocument(
  store: TestStore,
  fileId: string,
  diskContent = ''
): WorkingDocumentId {
  const state = store.getState()
  const file = state.openFiles.find((candidate) => candidate.id === fileId)
  if (!file) {
    throw new Error(`No open file ${fileId}`)
  }
  // Like openFile: the owner the store resolves for the file, else the file's own runtime.
  let target: WorkingDocumentTarget
  try {
    target = buildWorkingDocumentTarget(state, file)
  } catch {
    target = testWorkingDocumentTarget(file)
  }
  // Like openFile: a document is retained by the file's tabs, or by the file itself without one.
  const unifiedTabIds = Object.values(state.unifiedTabsByWorktree ?? {})
    .flat()
    .filter((tab) => tab.entityId === fileId)
    .map((tab) => tab.id)
  const tabIds = unifiedTabIds.length > 0 ? unifiedTabIds : [fileId]
  let documentId = getWorkingDocumentId(target.owner, target.filePath)
  for (const tabId of tabIds) {
    documentId = store.getState().retainWorkingDocument(tabId, target)
  }
  const document = store.getState().workingDocuments[documentId]!
  if (document.loadState !== 'ready') {
    store
      .getState()
      .acceptWorkingDocumentLoad(
        documentId,
        document.revision,
        diskContent,
        getDiskBaselineSignature(diskContent)
      )
  }
  return documentId
}

/** Gives an open file unsaved `content` over `diskContent`, shared by every tab of it. */
export function setTestDraft(
  store: TestStore,
  fileId: string,
  content: string,
  diskContent = ''
): WorkingDocumentId {
  const documentId = loadTestDocument(store, fileId, diskContent)
  store.getState().setWorkingDocumentContent(documentId, content)
  return documentId
}

/** The unsaved text a file's working document holds, or undefined when it is clean. */
export function testDraftOf(state: AppState, fileId: string): string | undefined {
  const document: WorkingDocument | undefined = getWorkingDocumentForFile(state, fileId)
  return document?.isDirty ? document.content : undefined
}
