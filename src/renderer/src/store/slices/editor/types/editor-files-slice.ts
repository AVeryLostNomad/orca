import type { HttpLinkSourceOwner } from '@/lib/http-link-routing'
import type { CheckRunDetailsTabPatch } from '@/components/editor/check-run-details-tab'
import type {
  CombinedDiffAlternate,
  ConflictReviewEntry,
  ConflictReviewState,
  OpenCheckRunDetailsState
} from '../../../../../../shared/editor-tab-view-types'
import type {
  GitBranchChangeEntry,
  GitBranchCompareSummary,
  GitCommitCompareSummary
} from '../../../../../../shared/git-diff-compare-types'
import type { GitStatusEntry } from '../../../../../../shared/git-status-types'
import type { WorkspaceVisibleTabType } from '../../../../../../shared/tab-types'
import type {
  BranchCompareLike,
  ClosedEditorTabSnapshot,
  CommitCompareLike,
  EditorOpenTargetOptions,
  EditorTabSelection,
  OpenFile
} from './open-file'
import type { EditorOpenLinkIntent, EditorOpenResult } from './editor-open-link-intent'
import type {
  OpenFilePathRekey,
  RekeyOpenFilesResult,
  WorkingDocumentPathRekey
} from './open-file-path-rekey'
import type {
  RestoredEditorOwnerMigration,
  RestoredEditorOwnerResult
} from './restored-editor-owner'

export type OpenFileOptions = {
  preview?: boolean
  targetGroupId?: string
  recordReplacedPreview?: boolean
  suppressActiveRuntimeFallback?: boolean
  forceContentReload?: boolean
  focusEditor?: boolean
  reopenId?: string
  selection?: EditorTabSelection
  /** Where in its group a reopened tab goes back to, when the open makes a new tab. */
  groupIndex?: number
  /** Skip unified-tab creation; the caller owns the surface (workspace notes pane). */
  suppressUnifiedTab?: boolean
}

export type EditorFilesSlice = {
  openFiles: OpenFile[]
  activeFileId: string | null
  activeFileIdByWorktree: Record<string, string | null>
  activeTabTypeByWorktree: Record<string, WorkspaceVisibleTabType>
  activeTabType: WorkspaceVisibleTabType
  setActiveTabType: (type: WorkspaceVisibleTabType, worktreeId: string | null) => void
  openFile: (file: Omit<OpenFile, 'id' | 'isDirty'>, options?: OpenFileOptions) => string
  /** Open captured link intent; null on refusal. onShown receives actual view after drawing, which requires main frame in layout-owner builds. */
  openFileForLink: (
    file: Omit<OpenFile, 'id' | 'isDirty'>,
    options: Omit<OpenFileOptions, 'targetGroupId' | 'focusEditor' | 'selection'> | undefined,
    intent: EditorOpenLinkIntent | null,
    onShown?: (result: EditorOpenResult | null) => void
  ) => EditorOpenResult | null
  openNewMarkdownInActiveWorkspace: (groupId: string) => Promise<void>
  openNewScratchFileInActiveWorkspace: (groupId: string) => Promise<void>
  // Why: sequences openFile/setMarkdownViewMode/reveal around an async Monaco remount. See docs/markdown-internal-link-opening-design.md.
  activateMarkdownLink: (
    rawHref: string | undefined,
    ctx: {
      sourceFilePath: string
      worktreeId: string
      worktreeRoot: string | null
      runtimeEnvironmentId?: string | null
      sourceOwner?: HttpLinkSourceOwner
    }
  ) => Promise<void>
  openMarkdownPreview: (
    file: Pick<
      OpenFile,
      | 'filePath'
      | 'relativePath'
      | 'worktreeId'
      | 'language'
      | 'runtimeEnvironmentId'
      | 'externalSshTargetId'
    > &
      Partial<Pick<OpenFile, 'terminalArtifactGrantId' | 'readOnly'>>,
    options?: { anchor?: string | null; targetGroupId?: string; sourceFileId?: string }
  ) => void
  makePreviewFilePermanent: (fileId: string, tabId?: string) => void
  pinFile: (fileId: string, tabId?: string) => void
  /** captureRecentlyClosed false keeps a cleanup close out of the reopen stack; dirty working documents outlive their last tab. */
  closeFile: (fileId: string, opts?: { captureRecentlyClosed?: boolean }) => void
  closeAllFiles: () => void
  /** Most recently closed editor tabs per worktree (for Cmd/Ctrl+Shift+T). */
  recentlyClosedEditorTabsByWorktree: Record<string, ClosedEditorTabSnapshot[]>
  reopenClosedEditorTab: (worktreeId: string) => boolean
  /** Activation uses the file's workspace unless a target is supplied; global selection
   *  moves only when that workspace is active. */
  setActiveFile: (fileId: string, targetWorktreeId?: string) => void
  /** Host grant for a file outside every workspace; grants lapse, so reads and saves renew them. */
  setTerminalArtifactGrant: (fileId: string, grantId: string) => void
  clearUntitled: (fileId: string) => void
  /** Atomically migrate path/ID-keyed editor state without close/reopen; stale/colliding moves leave state unchanged. */
  rekeyOpenFilesForPathChange: (args: {
    rekeys: readonly OpenFilePathRekey[]
    /** Includes retained combined-only documents that have no ordinary OpenFile. */
    documentRekeys?: readonly WorkingDocumentPathRekey[]
    /** When set, dirty autosave-capable destinations get move-echo provenance + a synchronous autosave gate so the watcher can content-verify the echo. */
    moveOperationId?: string
  }) => RekeyOpenFilesResult
  setRestoredEditorOwnerMigrationPending: (fileId: string, pending: boolean) => boolean
  reparentRestoredEditorFileOwner: (args: RestoredEditorOwnerMigration) => RestoredEditorOwnerResult
  openDiff: (
    worktreeId: string,
    filePath: string,
    relativePath: string,
    language: string,
    staged: boolean,
    options?: EditorOpenTargetOptions & { selection?: EditorTabSelection }
  ) => void
  openBranchDiff: (
    worktreeId: string,
    worktreePath: string,
    entry: GitBranchChangeEntry,
    compare: BranchCompareLike,
    language: string,
    options?: EditorOpenTargetOptions
  ) => void
  openCommitDiff: (
    worktreeId: string,
    worktreePath: string,
    entry: GitBranchChangeEntry,
    compare: CommitCompareLike,
    language: string,
    options?: EditorOpenTargetOptions
  ) => void
  openAllDiffs: (
    worktreeId: string,
    worktreePath: string,
    alternate?: CombinedDiffAlternate,
    areaFilter?: string,
    entriesSnapshot?: GitStatusEntry[]
  ) => void
  openConflictFile: (
    worktreeId: string,
    worktreePath: string,
    entry: GitStatusEntry,
    language: string,
    options?: EditorOpenTargetOptions
  ) => void
  openConflictReviewFile: (
    reviewFileId: string,
    worktreeId: string,
    worktreePath: string,
    entry: GitStatusEntry,
    language: string
  ) => void
  openConflictReview: (
    worktreeId: string,
    worktreePath: string,
    entries: ConflictReviewEntry[],
    source: ConflictReviewState['source']
  ) => void
  openCheckRunDetails: (
    worktreeId: string,
    contextKey: string,
    check: OpenCheckRunDetailsState['check'],
    state: CheckRunDetailsTabPatch
  ) => void
  patchOpenCheckRunDetails: (
    worktreeId: string,
    contextKey: string,
    check: OpenCheckRunDetailsState['check'],
    state: CheckRunDetailsTabPatch
  ) => void
  reloadOpenCheckRunDetailsTab: (fileId: string) => Promise<void>
  openBranchAllDiffs: (
    worktreeId: string,
    worktreePath: string,
    compare: GitBranchCompareSummary,
    alternate?: CombinedDiffAlternate
  ) => void
  openCommitAllDiffs: (
    worktreeId: string,
    worktreePath: string,
    compare: GitCommitCompareSummary,
    entries: GitBranchChangeEntry[],
    subject?: string,
    message?: string
  ) => void
}
