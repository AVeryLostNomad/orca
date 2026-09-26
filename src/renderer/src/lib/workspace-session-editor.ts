import type { WorkspaceVisibleTabType } from '../../../shared/tab-types'
import type {
  PersistedOpenFile,
  WorkspaceSessionState
} from '../../../shared/workspace-session-state-types'
import type { OpenFile } from '../store/slices/editor'
import type { AppState } from '../store/types'
import { getWorkingDocumentForFile } from '../store/slices/editor/working-document-state'
import type { WorkingDocument, WorkingDocumentId } from '../store/slices/editor/working-document'

type WorkingDocumentPersistenceState = Pick<
  AppState,
  'workingDocuments' | 'workingDocumentIdsByTab' | 'unifiedTabsByWorktree'
>

function persistedFileFromDocument(document: WorkingDocument): PersistedOpenFile {
  const { target } = document
  return {
    filePath: target.filePath,
    relativePath: target.relativePath,
    worktreeId: target.worktreeId,
    language: target.language,
    executionHostId: target.owner.executionHostId,
    runtimeEnvironmentId: target.owner.runtimeEnvironmentId,
    externalSshTargetId: target.externalSshTargetId,
    ...(document.alwaysAutoSave === true ? { alwaysAutoSave: true } : {}),
    ...(document.isDirty && document.content !== undefined
      ? { dirtyDraftContent: document.content }
      : {}),
    // Why: a restored dirty document verifies the disk state before it can autosave.
    ...(document.isDirty && document.content !== undefined && document.lastKnownDiskSignature
      ? { lastKnownDiskSignature: document.lastKnownDiskSignature }
      : {})
  }
}

function persistedFileFromOpenFile(file: OpenFile): PersistedOpenFile {
  return {
    filePath: file.filePath,
    relativePath: file.relativePath,
    worktreeId: file.worktreeId,
    language: file.language,
    isPreview: file.isPreview || undefined,
    runtimeEnvironmentId: file.runtimeEnvironmentId,
    externalSshTargetId: file.externalSshTargetId,
    ...(file.operationProvenance?.generation.route.executionHostId
      ? { executionHostId: file.operationProvenance.generation.route.executionHostId }
      : {}),
    // Why: persist readOnly only when true; absence is the writable default on restore.
    ...(file.readOnly === true ? { readOnly: true } : {}),
    ...(file.readOnly === true && file.liveTail === true ? { liveTail: true } : {}),
    ...(file.alwaysAutoSave === true ? { alwaysAutoSave: true } : {}),
    ...(file.workspaceNotesOwnerId ? { workspaceNotesOwnerId: file.workspaceNotesOwnerId } : {}),
    ...(file.isScratch === true ? { isScratch: true } : {})
  }
}

function documentForEditFile(
  file: OpenFile,
  persistence: WorkingDocumentPersistenceState
): WorkingDocument | undefined {
  return getWorkingDocumentForFile(persistence, file.id)
}

/** Builds editor session state from canonical documents. Diff containers remain transient, but a
 * dirty document retained only by one is recovered as one ordinary editable file on restart. */
export function buildEditorSessionData(
  openFiles: OpenFile[],
  persistence: WorkingDocumentPersistenceState,
  markdownFrontmatterVisible: Record<string, boolean>,
  activeFileIdByWorktree: Record<string, string | null>,
  activeTabTypeByWorktree: Record<string, WorkspaceVisibleTabType>
): Pick<
  WorkspaceSessionState,
  | 'openFilesByWorktree'
  | 'activeFileIdByWorktree'
  | 'activeTabTypeByWorktree'
  | 'markdownFrontmatterVisible'
> {
  const byWorktree: Record<string, PersistedOpenFile[]> = {}
  const editFileIdsByWorktree: Record<string, Set<string>> = {}
  const documentsRetainedByEditTab = new Set<WorkingDocumentId>()

  for (const file of openFiles) {
    if (file.mode !== 'edit') {
      continue
    }
    const document = documentForEditFile(file, persistence)
    const persistedFile = document
      ? persistedFileFromDocument(document)
      : persistedFileFromOpenFile(file)
    const worktreeFiles =
      byWorktree[persistedFile.worktreeId] ?? (byWorktree[persistedFile.worktreeId] = [])
    worktreeFiles.push(persistedFile)
    const fileIds =
      editFileIdsByWorktree[file.worktreeId] ?? (editFileIdsByWorktree[file.worktreeId] = new Set())
    fileIds.add(file.id)
    if (document) {
      documentsRetainedByEditTab.add(document.id)
    }
  }

  // A diff or combined tab is intentionally not restored. Its dirty document is, so a crash never
  // drops work merely because the only visible owner was a transient comparison surface.
  for (const document of Object.values(persistence.workingDocuments)) {
    if (
      !document.isDirty ||
      !document.writable ||
      document.content === undefined ||
      documentsRetainedByEditTab.has(document.id)
    ) {
      continue
    }
    const persistedFile = persistedFileFromDocument(document)
    const worktreeFiles =
      byWorktree[persistedFile.worktreeId] ?? (byWorktree[persistedFile.worktreeId] = [])
    worktreeFiles.push(persistedFile)
  }

  const activeFileEntries: [string, string][] = []
  for (const [worktreeId, fileId] of Object.entries(activeFileIdByWorktree)) {
    if (fileId && editFileIdsByWorktree[worktreeId]?.has(fileId)) {
      activeFileEntries.push([worktreeId, fileId])
    }
  }
  const persistedActiveFileIdByWorktree = Object.fromEntries(activeFileEntries) as Record<
    string,
    string
  >

  const activeTabTypeEntries: [string, WorkspaceVisibleTabType][] = []
  for (const [worktreeId, tabType] of Object.entries(activeTabTypeByWorktree)) {
    if (tabType !== 'editor' || persistedActiveFileIdByWorktree[worktreeId]) {
      activeTabTypeEntries.push([worktreeId, tabType])
    }
  }
  const persistedActiveTabTypeByWorktree = Object.fromEntries(activeTabTypeEntries) as Record<
    string,
    WorkspaceVisibleTabType
  >
  const allEditFileIds = new Set(Object.values(editFileIdsByWorktree).flatMap((ids) => [...ids]))
  // Why: preserve the value so per-file hide overrides survive restart (map only carries `false`; visible is the default).
  const persistedMarkdownFrontmatterVisible = Object.fromEntries(
    Object.entries(markdownFrontmatterVisible ?? {}).filter(([fileId]) =>
      allEditFileIds.has(fileId)
    )
  )

  return {
    openFilesByWorktree: byWorktree,
    activeFileIdByWorktree: persistedActiveFileIdByWorktree,
    activeTabTypeByWorktree: persistedActiveTabTypeByWorktree,
    markdownFrontmatterVisible: persistedMarkdownFrontmatterVisible
  }
}
