import type React from 'react'
import type { ComponentProps } from 'react'
import type { OpenFile } from '@/store/slices/editor'
import type { CombinedDiffTreeNavigation } from './browse-files/use-combined-diff-tree-navigation'
import { CombinedDiffFileTree } from './browse-files/combined-diff-file-tree'
import type { CombinedDiffSectionRetryActions } from './load-sections/use-combined-diff-section-retry'
import type { CombinedDiffEntrySet } from './resolve-changes/use-combined-diff-entry-set'
import type { CombinedDiffSectionRowKeys } from './resolve-changes/use-combined-diff-section-row-keys'
import { CombinedDiffSectionList } from './scroll-viewport/combined-diff-section-list'
import type { CombinedDiffScrollbar } from './scroll-viewport/use-combined-diff-scrollbar'
import type { CombinedDiffViewPreferences } from './review-controls/use-combined-diff-view-preferences'
import type { CombinedDiffNotesActions } from './review-controls/use-combined-diff-notes-actions'
import type { CombinedDiffSectionActions } from './review-controls/use-combined-diff-section-actions'
import { ClearDiffNotesDialog } from './review-controls/combined-diff-notes-popover'
import { CombinedDiffSkippedConflictNotice } from './review-controls/combined-diff-skipped-conflicts'
import { CombinedDiffToolbar } from './review-controls/combined-diff-toolbar'

type SectionListProps = ComponentProps<typeof CombinedDiffSectionList>

type CombinedDiffViewerContentProps = {
  activeGroupId: ComponentProps<typeof CombinedDiffToolbar>['activeGroupId']
  canOpenWorkspaceFileBrowserForPath: SectionListProps['canOpenWorkspaceFileBrowserForPath']
  commitHeader: React.ReactNode
  diffCommentsForWorktree: ComponentProps<typeof CombinedDiffToolbar>['diffCommentsForWorktree']
  entrySet: CombinedDiffEntrySet
  file: OpenFile
  loadSection: SectionListProps['loadSection']
  loadDeferredSection: SectionListProps['loadDeferredSection']
  markDirectScrollInput: SectionListProps['markDirectScrollInput']
  notes: CombinedDiffNotesActions
  onOpenAlternateDiff: () => void
  openTreeWorkingFile: NonNullable<ComponentProps<typeof CombinedDiffFileTree>['onOpenWorkingFile']>
  preferences: CombinedDiffViewPreferences
  retrySection: CombinedDiffSectionRetryActions['retrySection']
  sectionActions: CombinedDiffSectionActions
  sectionRowKeys: CombinedDiffSectionRowKeys
  sections: SectionListProps['sections']
  setScrollContainerRef: SectionListProps['setScrollContainerRef']
  settings: { diffShowWhitespace?: boolean; diffWordWrap?: boolean } | null
  skippedConflicts: OpenFile['skippedConflicts']
  treeNavigation: CombinedDiffTreeNavigation
  toggleSection: SectionListProps['toggleSection']
  virtualizer: SectionListProps['virtualizer']
  workingDocumentIdsBySectionKey: SectionListProps['workingDocumentIdsBySectionKey']
  scrollbar: Pick<CombinedDiffScrollbar, 'handleScrollbarPointerDown' | 'scrollThumb'>
  reviewSkippedConflicts: () => void
}

export function CombinedDiffViewerContent({
  activeGroupId,
  canOpenWorkspaceFileBrowserForPath,
  commitHeader,
  diffCommentsForWorktree,
  entrySet,
  file,
  loadSection,
  loadDeferredSection,
  markDirectScrollInput,
  notes,
  onOpenAlternateDiff,
  openTreeWorkingFile,
  preferences,
  retrySection,
  sectionActions,
  sectionRowKeys,
  sections,
  setScrollContainerRef,
  settings,
  skippedConflicts,
  treeNavigation,
  toggleSection,
  virtualizer,
  workingDocumentIdsBySectionKey,
  scrollbar,
  reviewSkippedConflicts
}: CombinedDiffViewerContentProps): React.JSX.Element {
  const skippedConflictNotice =
    (skippedConflicts?.length ?? 0) > 0 ? (
      <CombinedDiffSkippedConflictNotice
        onReviewConflicts={reviewSkippedConflicts}
        skippedConflicts={skippedConflicts!}
      />
    ) : null

  return (
    <>
      <div className="flex flex-col flex-1 min-h-0">
        <CombinedDiffToolbar
          activeGroupId={activeGroupId}
          allSectionsCollapsed={sectionRowKeys.allSectionsCollapsed}
          branchCompare={entrySet.branchCompare}
          commitCompare={entrySet.commitCompare}
          diffCommentCount={notes.diffCommentCount}
          diffCommentsForWorktree={diffCommentsForWorktree}
          diffShowWhitespace={settings?.diffShowWhitespace}
          diffWordWrap={settings?.diffWordWrap}
          file={file}
          fileTreeCollapsed={preferences.fileTreeCollapsed}
          isAllMode={entrySet.isAllMode}
          isBranchMode={entrySet.isBranchMode}
          isCommitMode={entrySet.isCommitMode}
          notesCopied={notes.notesCopied}
          onCopyNotes={() => void notes.handleCopyNotes()}
          onOpenAlternateDiff={onOpenAlternateDiff}
          onOpenClearNotes={() => notes.setClearNotesDialogOpen(true)}
          onShowFileTree={() => preferences.setFileTreeCollapsed(false)}
          previewDiffComments={notes.previewDiffComments}
          sectionCount={sections.length}
          setAllSectionsCollapsed={preferences.setAllSectionsCollapsed}
          sideBySide={preferences.sideBySide}
          toggleDiffShowWhitespace={preferences.toggleDiffShowWhitespace}
          toggleDiffWordWrap={preferences.toggleDiffWordWrap}
          toggleSideBySide={preferences.toggleSideBySide}
        />

        {commitHeader}
        <div className="flex min-h-0 flex-1">
          <CombinedDiffFileTree
            mode={entrySet.treeMode}
            worktreePath={file.filePath}
            entries={entrySet.entries}
            sectionIndexByKey={treeNavigation.sectionIndexByKey}
            activeSectionKey={treeNavigation.activeTreeSectionKey}
            viewedSectionKeys={treeNavigation.viewedSectionKeys}
            collapsed={preferences.fileTreeCollapsed}
            onCollapsedChange={preferences.setFileTreeCollapsed}
            onNavigate={treeNavigation.handleTreeNavigate}
            onOpenWorkingFile={openTreeWorkingFile}
          />
          <CombinedDiffSectionList
            activeGroupId={activeGroupId}
            canOpenWorkspaceFileBrowserForPath={canOpenWorkspaceFileBrowserForPath}
            diffCommentsForWorktree={diffCommentsForWorktree}
            file={file}
            handleSectionSaveRef={sectionActions.handleSectionSaveRef}
            isAllMode={entrySet.isAllMode}
            isBranchMode={entrySet.isBranchMode}
            isCommitMode={entrySet.isCommitMode}
            loadSection={loadSection}
            loadDeferredSection={loadDeferredSection}
            markDirectScrollInput={markDirectScrollInput}
            onScrollbarPointerDown={scrollbar.handleScrollbarPointerDown}
            openSection={sectionActions.openSection}
            openSectionPreview={sectionActions.openSectionPreview}
            retrySection={retrySection}
            scrollThumb={scrollbar.scrollThumb}
            sections={sections}
            setScrollContainerRef={setScrollContainerRef}
            sideBySide={preferences.sideBySide}
            skippedConflictNotice={skippedConflictNotice}
            toggleSection={toggleSection}
            virtualizer={virtualizer}
            workingDocumentIdsBySectionKey={workingDocumentIdsBySectionKey}
          />
        </div>
      </div>
      <ClearDiffNotesDialog
        diffCommentCount={notes.diffCommentCount}
        isClearingNotes={notes.isClearingNotes}
        onConfirm={() => void notes.handleConfirmClearNotes()}
        open={notes.clearNotesDialogVisible}
        setOpen={notes.setClearNotesDialogOpen}
      />
    </>
  )
}
