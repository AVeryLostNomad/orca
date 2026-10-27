import type { WorkingDocument, WorkingDocumentId } from '@/store/slices/editor/working-document'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { documentSaveGrant, documentSaveTab, writeDocumentFile } from './editor-document-save-grant'
import { selectWorktreesByRepo } from '@/store/workspace-record-selectors'
import { editorTabFileAccess } from '@/lib/local-file-access'
import { getEditorFileOperationContext } from '@/lib/editor-file-operation-owner'
import { EditorSaveDiscardedError } from './editor-discard-epoch'
import { ORCA_EDITOR_DOCUMENT_SAVED_EVENT, type EditorDocumentSavedDetail } from './editor-autosave'
import {
  clearSelfWrite,
  recordSelfWrite,
  SELF_WRITE_REMOTE_TTL_MS
} from './editor-self-write-registry'
import { getWrittenContentDiskSignature } from '../../../../shared/disk-baseline-signature'
import {
  EDITOR_NOT_UTF8_SAVE_MESSAGE,
  EDITOR_STALE_SAVE_MESSAGE,
  type EditorSaveTrigger
} from './editor-save-refusal'
import {
  pauseAutosaveForNonUtf8File,
  resumeAutosaveForNonUtf8File
} from './editor-non-utf8-autosave-pause'
import type {
  FileWriteDiskPrecondition,
  FileWriteResult
} from '../../../../shared/file-write-disk-precondition'
import type { AppStoreApi } from './editor-save-queue'

export type DocumentSaveTrigger = Exclude<EditorSaveTrigger, 'restart'>

// Keep My Edits restamps the baseline from a disk read; saves wait for it, and a newer write wins.
const pendingBaselineRestamps = new Map<WorkingDocumentId, Promise<void>>()
const supersededBaselineRestamps = new Set<WorkingDocumentId>()

/** Registers Keep My Edits' disk read so saves of the document wait for its new baseline. */
export function trackDocumentBaselineRestamp(
  documentId: WorkingDocumentId,
  restamp: Promise<void>
): void {
  const tracked = restamp.catch(() => undefined)
  pendingBaselineRestamps.set(documentId, tracked)
  supersededBaselineRestamps.delete(documentId)
  void tracked.then(() => {
    if (pendingBaselineRestamps.get(documentId) === tracked) {
      pendingBaselineRestamps.delete(documentId)
      supersededBaselineRestamps.delete(documentId)
    }
  })
}

/** True once a write landed after the Keep read started; that read must not restamp over it. */
export function isDocumentBaselineRestampSuperseded(documentId: WorkingDocumentId): boolean {
  return supersededBaselineRestamps.has(documentId)
}

function noteDocumentBaselineWrite(documentId: WorkingDocumentId): void {
  if (pendingBaselineRestamps.has(documentId)) {
    supersededBaselineRestamps.add(documentId)
  }
}

export function waitForDocumentBaselineRestamp(documentId: WorkingDocumentId): Promise<void> {
  return pendingBaselineRestamps.get(documentId) ?? Promise.resolve()
}

/** Only Overwrite skips the disk guard; Convert alone may replace bytes that aren't valid UTF-8. */
function documentSavePrecondition(
  baseline: string | undefined,
  trigger: DocumentSaveTrigger
): FileWriteDiskPrecondition | undefined {
  if (trigger === 'overwrite' || baseline === undefined) {
    return undefined
  }
  return {
    expectedSignature: baseline,
    // Autosave must not resurrect deleted files; explicit saves may.
    allowMissing: trigger !== 'autosave',
    ...(trigger === 'convert' ? {} : { requireLosslessUtf8: true })
  }
}

/** Guarded write of a ready document; refusals raise the conflict banner or the UTF-8 pause. */
export async function writeWorkingDocument(
  store: AppStoreApi,
  document: WorkingDocument,
  trigger: DocumentSaveTrigger,
  /** Checked at the last moment before bytes are sent; false drops the write silently. */
  isStillQueued: () => boolean
): Promise<void> {
  const documentId = document.id
  const state = store.getState()
  const contentToSave = document.content
  if (contentToSave === undefined) {
    return
  }
  // Why: a document without a known disk version can't be guarded; refuse instead of writing unchecked.
  if (document.lastKnownDiskSignature === undefined && trigger !== 'overwrite') {
    if (trigger === 'autosave') {
      return
    }
    store.getState().setWorkingDocumentExternalState(documentId, { externalMutation: 'changed' })
    throw new Error(EDITOR_STALE_SAVE_MESSAGE)
  }
  const worktree = findWorktreeById(selectWorktreesByRepo(state), document.target.worktreeId)
  const fileContext = getEditorFileOperationContext(
    state,
    {
      worktreeId: document.target.worktreeId,
      runtimeEnvironmentId: document.target.owner.runtimeEnvironmentId,
      externalSshTargetId: document.target.externalSshTargetId,
      operationProvenance: document.target.operationProvenance
    },
    worktree?.path ?? null
  )
  const remoteWrite = Boolean(
    fileContext.connectionId || document.target.owner.runtimeEnvironmentId
  )
  recordSelfWrite(documentId, contentToSave, remoteWrite ? SELF_WRITE_REMOTE_TTL_MS : undefined)
  // The tab carries the file authority: a user-named path or a host grant outside every workspace.
  const tab = documentSaveTab(state, document)
  let writeResult: FileWriteResult
  try {
    writeResult = await writeDocumentFile(
      fileContext,
      document.target.filePath,
      contentToSave,
      editorTabFileAccess(state, tab),
      documentSavePrecondition(document.lastKnownDiskSignature, trigger),
      // Remote host checks await; a discard or quiesce meanwhile must still prevent the write.
      () => {
        if (!isStillQueued()) {
          throw new EditorSaveDiscardedError()
        }
      },
      documentSaveGrant(tab, fileContext, () => store.getState())
    )
  } catch (error) {
    clearSelfWrite(documentId)
    if (error instanceof EditorSaveDiscardedError) {
      return
    }
    throw error
  }
  if (!writeResult.ok) {
    clearSelfWrite(documentId)
    if (writeResult.diskConflict === 'not-utf8') {
      // Why: an explicit save asks to convert instead; only autosave pauses (and says so once).
      if (trigger !== 'autosave') {
        throw new Error(EDITOR_NOT_UTF8_SAVE_MESSAGE)
      }
      pauseAutosaveForNonUtf8File({
        filePath: document.target.filePath,
        runtimeEnvironmentId: document.target.owner.runtimeEnvironmentId
      })
      return
    }
    // Why: disk moved under unsaved edits; surface the conflict banner instead of clobbering it.
    store.getState().setWorkingDocumentExternalState(documentId, {
      externalMutation: writeResult.diskConflict === 'missing' ? 'deleted' : 'changed'
    })
    if (trigger !== 'autosave') {
      throw new Error(EDITOR_STALE_SAVE_MESSAGE)
    }
    return
  }

  if (trigger !== 'autosave') {
    // A confirmed explicit write leaves UTF-8 text on disk, lifting any autosave pause.
    resumeAutosaveForNonUtf8File({
      filePath: document.target.filePath,
      runtimeEnvironmentId: document.target.owner.runtimeEnvironmentId
    })
  }
  noteDocumentBaselineWrite(documentId)
  if (writeResult.unchanged) {
    // The disk already held this text, so no watcher echo will follow.
    clearSelfWrite(documentId)
  }
  // Why written-content signature: lone surrogates land on disk as U+FFFD.
  const savedSignature = getWrittenContentDiskSignature(contentToSave)
  const nextState = store.getState()
  nextState.commitWorkingDocumentSave(documentId, contentToSave, savedSignature)
  const savedDocument = nextState.workingDocuments[documentId]
  if (!savedDocument) {
    return
  }
  window.dispatchEvent(
    new CustomEvent<EditorDocumentSavedDetail>(ORCA_EDITOR_DOCUMENT_SAVED_EVENT, {
      detail: {
        documentId,
        owner: savedDocument.target.owner,
        filePath: savedDocument.target.filePath,
        content: contentToSave
      }
    })
  )
}
