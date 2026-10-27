import type { RecentlyClosedTabPosition } from '../../recently-closed-tabs'
import type { EditorFileOperationProvenance } from '@/lib/editor-file-operation-owner'
import type {
  GitBranchChangeEntry,
  GitBranchCompareSummary,
  GitCommitCompareSummary
} from '../../../../../../shared/git-diff-compare-types'
import type { GitStatusEntry } from '../../../../../../shared/git-status-types'
import type {
  BranchCompareSnapshot,
  CombinedDiffAlternate,
  CombinedDiffSkippedConflict,
  CommitCompareSnapshot,
  ConflictReviewState,
  DiffSource,
  OpenCheckRunDetailsState,
  OpenConflictMetadata
} from '../../../../../../shared/editor-tab-view-types'

export type BranchCompareLike = Pick<
  GitBranchCompareSummary,
  'baseRef' | 'baseOid' | 'compareRef' | 'headOid' | 'mergeBase'
>

export type CommitCompareLike = Pick<
  GitCommitCompareSummary,
  'commitOid' | 'parentOid' | 'compareRef' | 'baseRef'
> & {
  subject?: string
  message?: string
}

// Check mode before filePath: OpenFile is not a discriminated union and conflict-review paths name roots, not files.
// Snapshot skippedConflicts to keep combined-diff exclusion notices stable across polls.
// Keep combined-branch entries across inactive-workspace switches when compare caches are stale.
export type OpenFile = {
  id: string
  filePath: string
  relativePath: string
  worktreeId: string
  language: string
  isDirty: boolean
  // Why: remote untitled cleanup must target the creating environment even if the user later switches runtime.
  runtimeEnvironmentId?: string | null
  /** SSH target that owns an absolute path outside the worktree. */
  externalSshTargetId?: string
  /** Host grant for a file outside every workspace on `runtimeEnvironmentId`; never persisted. */
  terminalArtifactGrantId?: string
  /** Host provenance captured when the tab opened; mutations reject replacement owners. */
  operationProvenance?: EditorFileOperationProvenance
  /** Why: preview tabs mirror a source file's live draft; storing its ID lets the preview follow unsaved edits without becoming editable. */
  markdownPreviewSourceFileId?: string
  /** Hash fragment to reveal when a preview tab opens from a link (`./guide.md#setup`); kept on tab state so repeat opens can retarget it. */
  markdownPreviewAnchor?: string
  diffSource?: DiffSource
  branchCompare?: BranchCompareSnapshot
  commitCompare?: CommitCompareSnapshot
  branchOldPath?: string
  combinedAlternate?: CombinedDiffAlternate
  combinedAreaFilter?: string
  branchEntriesSnapshot?: GitBranchChangeEntry[]
  commitEntriesSnapshot?: GitBranchChangeEntry[]
  // Snapshot uncommitted entries at open or later commits rebuild the diff and lose loaded content/scroll.
  uncommittedEntriesSnapshot?: GitStatusEntry[]
  conflict?: OpenConflictMetadata
  skippedConflicts?: CombinedDiffSkippedConflict[]
  conflictReview?: ConflictReviewState
  isPreview?: boolean
  isUntitled?: boolean
  deleteUntouchedOnClose?: boolean
  /** Scratch tab: lives in the local app-owned scratch dir, deleted from disk unconditionally on close, and content-based language detection renames its extension. */
  isScratch?: boolean
  /** Why: diff bodies are cached in EditorPanel; bump this on re-select so the panel refetches instead of reusing a stale snapshot. */
  diffContentReloadNonce?: number
  /** Why: bumping refetches clean tabs — the user's manual recovery when a remote watcher misses an external write. */
  fileContentReloadNonce?: number
  /** Why: CI check-details tabs are virtual editor tabs backed by fetched PR check-run metadata, not a file on disk. */
  checkRunDetails?: OpenCheckRunDetailsState
  // Only host-mirrored tabs may be culled on omission; locally opened tabs survive.
  mirroredFromRuntimeSession?: boolean
  // Read-only is orthogonal to mode: logs cannot edit/autosave/rename; persist only true.
  readOnly?: boolean
  /** Autosaves even when the global editorAutoSave setting is off (workspace notes). */
  alwaysAutoSave?: boolean
  /** Workspace key this floating notes file belongs to; no unified tab backs it. */
  workspaceNotesOwnerId?: string
  /** Transient: paged CSV data must never become an editable buffer. */
  csvPreviewOnly?: boolean
  /** Why: explicit live tail, only meaningful for a read-only local log. */
  liveTail?: boolean
  mode: 'edit' | 'diff' | 'conflict-review' | 'markdown-preview' | 'check-details'
}

export type ActivityBarPosition = 'top' | 'side'

export type MarkdownViewMode = 'source' | 'rich' | 'preview'

// Why: orthogonal to MarkdownViewMode; 'changes' renders diff-vs-HEAD in place of the editor without a separate tab. See reviews/changes-view-mode-plan.md.
export type EditorViewMode = 'edit' | 'changes'

/** Enough state to restore a tab via `openFile` after `closeFile`. */
// Why: omit mirroredFromRuntimeSession so a user-reopened tab isn't treated as host-owned and culled by the next web session sync.
export type ClosedEditorTabSnapshot = Omit<
  OpenFile,
  'id' | 'isDirty' | 'mirroredFromRuntimeSession'
> & {
  reopenId?: string
  position?: RecentlyClosedTabPosition
}

export const MAX_RECENT_CLOSED_EDITOR_TABS = 10

/**
 * How an editor open selects its tab. 'focus' (default) selects it as a user action; 'background'
 * selects it inside its own worktree without stamping its focus time; 'none' only adds it.
 */
export type EditorTabSelection = 'focus' | 'background' | 'none'

export type EditorOpenTargetOptions = {
  targetGroupId?: string
  preview?: boolean
  runtimeEnvironmentId?: string | null
  forceContentReload?: boolean
}
