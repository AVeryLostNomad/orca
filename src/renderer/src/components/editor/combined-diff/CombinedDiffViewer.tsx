import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { createProgrammaticScrollMarks } from '@/hooks/programmatic-scroll-marks'
import { useWorkspaceFileBrowserActionPredicate } from '@/lib/file-preview'
import { openReviewWorkingFile } from '@/lib/review-working-file'
import { selectWorktreeDiffCommentsOrEmpty } from '@/store/worktree-diff-comments-selector'
import type { OpenFile } from '@/store/slices/editor'
import '@/lib/monaco-setup'
import { ORCA_EDITOR_REQUEST_CMD_SAVE_EVENT } from '../editor-autosave'
import type { DiffSection } from '../diff-section-types'
import {
  EMPTY_GIT_BRANCH_ENTRIES,
  EMPTY_GIT_STATUS_ENTRIES,
  useCombinedDiffEntrySet
} from './resolve-changes/use-combined-diff-entry-set'
import type { CombinedDiffFileTreeEntry } from './resolve-changes/combined-diff-section-identity'
import { useCombinedDiffSectionIndexMap } from './resolve-changes/use-combined-diff-section-index-map'
import { useCombinedDiffSectionRowKeys } from './resolve-changes/use-combined-diff-section-row-keys'
import { useCombinedDiffSectionLoadRegistry } from './load-sections/combined-diff-section-load-registry'
import { useCombinedDiffSectionLoader } from './load-sections/use-combined-diff-section-loader'
import { useCombinedDiffSectionRetry } from './load-sections/use-combined-diff-section-retry'
import { useCombinedDiffSectionRevalidation } from './load-sections/use-combined-diff-section-revalidation'
import { useCombinedDiffViewPersist } from './remember-view/use-combined-diff-view-persist'
import { useCombinedDiffViewRestore } from './remember-view/use-combined-diff-view-restore'
import { useCombinedDiffDirectScrollInput } from './scroll-viewport/use-combined-diff-direct-scroll-input'
import { useCombinedDiffScrollAnchors } from './scroll-viewport/use-combined-diff-scroll-anchors'
import { useCombinedDiffScrollPersistence } from './scroll-viewport/use-combined-diff-scroll-persistence'
import { useCombinedDiffScrollbar } from './scroll-viewport/use-combined-diff-scrollbar'
import { useCombinedDiffVirtualizer } from './scroll-viewport/use-combined-diff-virtualizer'
import { CombinedDiffViewerContent } from './CombinedDiffViewerContent'
import { useCombinedDiffTreeNavigation } from './browse-files/use-combined-diff-tree-navigation'
import { CombinedDiffCommitHeader } from './review-controls/combined-diff-commit-header'
import {
  CombinedDiffNoChangesEmptyState,
  CombinedDiffSkippedConflictsEmptyState
} from './review-controls/combined-diff-skipped-conflicts'
import { useCombinedDiffNotesActions } from './review-controls/use-combined-diff-notes-actions'
import { useCombinedDiffSectionActions } from './review-controls/use-combined-diff-section-actions'
import { useCombinedDiffViewPreferences } from './review-controls/use-combined-diff-view-preferences'
import { useCombinedDiffWorkingDocuments } from './use-combined-diff-working-documents'

export default function CombinedDiffViewer({
  file,
  viewStateKey,
  tabId
}: {
  file: OpenFile
  viewStateKey: string
  tabId: string
}): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const gitStatusEntries = useAppStore(
    (s) => s.gitStatusByWorktree[file.worktreeId] ?? EMPTY_GIT_STATUS_ENTRIES
  )
  const liveBranchEntries = useAppStore(
    (s) => s.gitBranchChangesByWorktree[file.worktreeId] ?? EMPTY_GIT_BRANCH_ENTRIES
  )
  const branchSummary = useAppStore((s) => s.gitBranchCompareSummaryByWorktree[file.worktreeId])
  const openAllDiffs = useAppStore((s) => s.openAllDiffs)
  const openConflictReview = useAppStore((s) => s.openConflictReview)
  const openBranchAllDiffs = useAppStore((s) => s.openBranchAllDiffs)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const clearDiffComments = useAppStore((s) => s.clearDiffComments)
  const diffCommentsForWorktree = useAppStore((s) =>
    selectWorktreeDiffCommentsOrEmpty(s, file.worktreeId)
  )
  const activeGroupId = useAppStore((s) => s.activeGroupIdByWorktree[file.worktreeId])
  const canOpenWorkspaceFileBrowserForPath = useWorkspaceFileBrowserActionPredicate(file.worktreeId)

  const [sections, setSections] = useState<DiffSection[]>([])
  const [sectionHeights, setSectionHeights] = useState<Record<number, number>>({})
  const [generation, setGeneration] = useState(0)
  // Why: a browser scroll clamp must re-pin the restore without being recorded as user intent.
  const [clampRestoreCount, setClampRestoreCount] = useState(0)
  const [programmaticScrollMarks] = useState(createProgrammaticScrollMarks)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const registry = useCombinedDiffSectionLoadRegistry(sections)
  const entrySet = useCombinedDiffEntrySet({
    file,
    gitStatusEntries,
    liveBranchEntries,
    sectionsRef: registry.sectionsRef
  })
  const notes = useCombinedDiffNotesActions({
    clearDiffComments,
    diffCommentsForWorktree,
    worktreeId: file.worktreeId
  })
  const preferences = useCombinedDiffViewPreferences({
    combinedDiffFileTreeVisibleByDefault: settings?.combinedDiffFileTreeVisibleByDefault,
    diffDefaultView: settings?.diffDefaultView,
    diffShowWhitespace: settings?.diffShowWhitespace,
    diffWordWrap: settings?.diffWordWrap,
    registry,
    setSections,
    updateSettings
  })
  const restore = useCombinedDiffViewRestore({
    entrySet,
    gitStatusEntries,
    registry,
    setGeneration,
    setSectionHeights,
    setSections,
    setSideBySide: preferences.setSideBySide,
    viewStateKey
  })
  const { loadSection, loadDeferredSection } = useCombinedDiffSectionLoader({
    entrySet,
    file,
    registry,
    sectionCount: sections.length,
    setSectionHeights,
    setSections
  })
  const { ensureSectionLoaded, requestSectionReload, retrySection } = useCombinedDiffSectionRetry({
    invalidateViewStateCache: restore.invalidateViewStateCache,
    registry,
    setSectionHeights,
    setSections
  })

  const workingDocumentIdsBySectionKey = useCombinedDiffWorkingDocuments({ file, sections, tabId })
  // Why: one incremental scan of `sections` feeds the virtualizer keys, the restore signal and the
  // toolbar collapse state, instead of three independent full passes per loaded section.
  const sectionRowKeys = useCombinedDiffSectionRowKeys({ generation, sections })
  const sectionIndexByKey = useCombinedDiffSectionIndexMap({
    entrySignature: entrySet.entrySignature,
    sections
  })
  const { hasDirectScrollInput, markDirectScrollInput } = useCombinedDiffDirectScrollInput()
  const { cleanupActiveScrollbarDrag, handleScrollbarPointerDown, scrollThumb, updateScrollbar } =
    useCombinedDiffScrollbar({ markDirectScrollInput, scrollContainerRef })
  const virtualizer = useCombinedDiffVirtualizer({
    generation,
    programmaticScrollMarks,
    renderedIndicesRef: registry.renderedIndicesRef,
    rowKeys: sectionRowKeys.rowKeys,
    scrollContainerRef,
    scrollOffsetRef: restore.scrollOffsetRef,
    sectionHeights,
    sections,
    sideBySide: preferences.sideBySide
  })
  const anchors = useCombinedDiffScrollAnchors({
    clampRestoreCount,
    generation,
    hasDirectScrollInput,
    latestDomScrollAnchorRef: restore.latestDomScrollAnchorRef,
    programmaticScrollMarks,
    scrollAnchorRef: restore.scrollAnchorRef,
    scrollContainerRef,
    scrollOffsetRef: restore.scrollOffsetRef,
    sectionIndexByKey,
    sections,
    sectionsRef: registry.sectionsRef,
    sideBySide: preferences.sideBySide,
    structureRevision: sectionRowKeys.structureRevision,
    totalSize: virtualizer.getTotalSize(),
    viewStateKey,
    virtualizer
  })

  const toggleSection = useCallback(
    (index: number) => {
      const shouldLoadAfterExpand = registry.sectionsRef.current[index]?.collapsed ?? false
      setSections((prev) =>
        prev.map((s, i) => (i === index ? { ...s, collapsed: !s.collapsed } : s))
      )
      if (shouldLoadAfterExpand) {
        registry.loadSchedulerRef.current.request(index)
      }
    },
    [registry.loadSchedulerRef, registry.sectionsRef]
  )

  const treeNavigation = useCombinedDiffTreeNavigation({
    ensureSectionLoaded,
    entrySignature: entrySet.entrySignature,
    markDirectScrollInput,
    scrollToIndex: anchors.scrollToSectionIndex,
    sectionIndexByKey,
    sections,
    sectionsRef: registry.sectionsRef,
    toggleSection,
    treeMode: entrySet.treeMode
  })
  const openTreeWorkingFile = useCallback(
    (entry: CombinedDiffFileTreeEntry) => {
      const state = useAppStore.getState()
      const targetGroupId =
        (state.unifiedTabsByWorktree[file.worktreeId] ?? []).find((tab) => tab.id === tabId)
          ?.groupId ?? state.activeGroupIdByWorktree[file.worktreeId]
      void openReviewWorkingFile({
        worktreeId: file.worktreeId,
        worktreePath: file.filePath,
        relativePath: entry.path,
        targetGroupId,
        preview: false
      })
    },
    [file.filePath, file.worktreeId, tabId]
  )

  const combinedGitStatusSignature = useCombinedDiffSectionRevalidation({
    file,
    gitStatusEntries,
    registry,
    requestSectionReload,
    sectionIndexByKeyRef: treeNavigation.sectionIndexByKeyRef,
    sectionEntries: entrySet.entries,
    shouldAutoReloadFromGitStatus: entrySet.shouldAutoReloadFromGitStatus,
    treeMode: entrySet.treeMode
  })
  const sectionActions = useCombinedDiffSectionActions({
    activeGroupId,
    branchCompare: entrySet.branchCompare,
    canOpenWorkspaceFileBrowserForPath,
    commitCompare: entrySet.commitCompare,
    file,
    isAllMode: entrySet.isAllMode,
    isBranchMode: entrySet.isBranchMode,
    isCommitMode: entrySet.isCommitMode,
    sectionsRef: registry.sectionsRef,
    tabId,
    workingDocumentIdsBySectionKey
  })
  const { saveDirtyDocuments } = sectionActions
  useEffect(() => {
    const handleCommandSave = (event: Event): void => {
      const commandTabId = (event as CustomEvent<{ tabId?: string }>).detail?.tabId
      if (commandTabId === tabId) {
        void saveDirtyDocuments()
      }
    }
    window.addEventListener(ORCA_EDITOR_REQUEST_CMD_SAVE_EVENT, handleCommandSave)
    return () => window.removeEventListener(ORCA_EDITOR_REQUEST_CMD_SAVE_EVENT, handleCommandSave)
  }, [saveDirtyDocuments, tabId])

  useCombinedDiffViewPersist({
    combinedGitStatusSignature,
    entryCount: entrySet.entries.length,
    entrySignature: entrySet.entrySignature,
    loadedIndicesRef: registry.loadedIndicesRef,
    scrollContainerRef,
    sectionHeights,
    sections,
    sideBySide: preferences.sideBySide,
    viewStateKey
  })
  useCombinedDiffScrollPersistence({
    anchors,
    entrySignature: entrySet.entrySignature,
    hasDirectScrollInput,
    latestDomScrollAnchorRef: restore.latestDomScrollAnchorRef,
    programmaticScrollMarks,
    scrollAnchorRef: restore.scrollAnchorRef,
    scrollContainerRef,
    scrollOffsetRef: restore.scrollOffsetRef,
    sectionCount: sections.length,
    sectionHeights,
    sections,
    setClampRestoreCount,
    updateScrollbar,
    viewStateKey
  })

  const openAlternateDiff = useCallback(() => {
    if (!file.combinedAlternate) {
      return
    }

    if (file.combinedAlternate.source === 'combined-all') {
      openAllDiffs(file.worktreeId, file.filePath)
      return
    }

    if (branchSummary && branchSummary.status === 'ready') {
      openBranchAllDiffs(file.worktreeId, file.filePath, branchSummary, {
        source: 'combined-all'
      })
    }
  }, [branchSummary, file, openAllDiffs, openBranchAllDiffs])

  const { setScrollSurfaceMounted } = notes
  const setScrollContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollContainerRef.current = node
      setScrollSurfaceMounted(node !== null)
      if (node === null) {
        cleanupActiveScrollbarDrag()
        return
      }
      window.requestAnimationFrame(updateScrollbar)
    },
    [cleanupActiveScrollbarDrag, setScrollSurfaceMounted, updateScrollbar]
  )

  const skippedConflicts = file.skippedConflicts
  const reviewSkippedConflicts = useCallback(() => {
    openConflictReview(
      file.worktreeId,
      file.filePath,
      (skippedConflicts ?? []).map((entry) => ({
        path: entry.path,
        conflictKind: entry.conflictKind
      })),
      'combined-diff-exclusion'
    )
  }, [file.filePath, file.worktreeId, openConflictReview, skippedConflicts])

  const commitHeader =
    entrySet.isCommitMode && entrySet.commitCompare ? (
      <CombinedDiffCommitHeader commitCompare={entrySet.commitCompare} />
    ) : null

  if (sections.length === 0 && (skippedConflicts?.length ?? 0) > 0) {
    return (
      <CombinedDiffSkippedConflictsEmptyState
        commitHeader={commitHeader}
        onReviewConflicts={reviewSkippedConflicts}
        skippedConflicts={skippedConflicts!}
      />
    )
  }

  if (sections.length === 0) {
    return <CombinedDiffNoChangesEmptyState commitHeader={commitHeader} />
  }

  return (
    <CombinedDiffViewerContent
      activeGroupId={activeGroupId}
      canOpenWorkspaceFileBrowserForPath={canOpenWorkspaceFileBrowserForPath}
      commitHeader={commitHeader}
      diffCommentsForWorktree={diffCommentsForWorktree}
      entrySet={entrySet}
      file={file}
      loadSection={loadSection}
      loadDeferredSection={loadDeferredSection}
      markDirectScrollInput={markDirectScrollInput}
      notes={notes}
      onOpenAlternateDiff={openAlternateDiff}
      openTreeWorkingFile={openTreeWorkingFile}
      preferences={preferences}
      retrySection={retrySection}
      sectionActions={sectionActions}
      sectionRowKeys={sectionRowKeys}
      sections={sections}
      setScrollContainerRef={setScrollContainerRef}
      settings={settings}
      skippedConflicts={skippedConflicts}
      treeNavigation={treeNavigation}
      toggleSection={toggleSection}
      virtualizer={virtualizer}
      workingDocumentIdsBySectionKey={workingDocumentIdsBySectionKey}
      scrollbar={{ handleScrollbarPointerDown, scrollThumb }}
      reviewSkippedConflicts={reviewSkippedConflicts}
    />
  )
}
