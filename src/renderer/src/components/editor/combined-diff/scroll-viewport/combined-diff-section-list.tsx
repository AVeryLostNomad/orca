import type React from 'react'
import { useMemo } from 'react'
import type { Virtualizer } from '@tanstack/react-virtual'
import { joinPath } from '@/lib/path'
import type { OpenFile } from '@/store/slices/editor'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import type { DiffComment } from '../../../../../../shared/diff-comment-types'
import { PierreDiffSection } from '@/components/pierre-diff/PierreDiffSection'
import { DiffNotesSendMenu } from '../../DiffNotesSendMenu'
import { canOpenDiffSectionPreviewToSide } from '../../diff-section-preview'
import type { DiffSection } from '../../diff-section-types'
import type { CombinedDiffScrollThumb } from './use-combined-diff-scrollbar'

export function CombinedDiffSectionList({
  activeGroupId,
  canOpenWorkspaceFileBrowserForPath,
  diffCommentsForWorktree,
  file,
  handleSectionSaveRef,
  isAllMode,
  isBranchMode,
  isCommitMode,
  loadSection,
  loadDeferredSection,
  markDirectScrollInput,
  onScrollbarPointerDown,
  openSection,
  openSectionPreview,
  retrySection,
  scrollThumb,
  sideBySide,
  skippedConflictNotice,
  toggleSection,
  sections,
  setScrollContainerRef,
  virtualizer,
  workingDocumentIdsBySectionKey
}: {
  activeGroupId: string | undefined
  canOpenWorkspaceFileBrowserForPath: (path: string) => boolean
  diffCommentsForWorktree: DiffComment[]
  file: OpenFile
  handleSectionSaveRef: React.MutableRefObject<(index: number) => Promise<void>>
  isAllMode: boolean
  isBranchMode: boolean
  isCommitMode: boolean
  loadSection: (index: number) => void
  loadDeferredSection: (index: number) => void
  markDirectScrollInput: () => void
  onScrollbarPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  openSection: (index: number) => void
  openSectionPreview: (section: DiffSection) => void
  retrySection: (index: number) => void
  scrollThumb: CombinedDiffScrollThumb
  sideBySide: boolean
  skippedConflictNotice: React.ReactNode
  toggleSection: (index: number) => void
  sections: DiffSection[]
  setScrollContainerRef: (node: HTMLDivElement | null) => void
  virtualizer: Virtualizer<HTMLDivElement, Element>
  workingDocumentIdsBySectionKey: Readonly<Record<string, WorkingDocumentId>>
}): React.JSX.Element {
  // Why: per-row filter() rescanned all worktree comments per visible row per render — index once, same order preserved.
  const commentCountByFilePath = useMemo(() => {
    const counts = new Map<string, number>()
    for (const comment of diffCommentsForWorktree) {
      counts.set(comment.filePath, (counts.get(comment.filePath) ?? 0) + 1)
    }
    return counts
  }, [diffCommentsForWorktree])
  return (
    <div className="relative min-w-0 flex-1">
      <div
        ref={setScrollContainerRef}
        className="combined-diff-scroll-container h-full overflow-auto pr-5 scrollbar-editor"
        onWheel={markDirectScrollInput}
        onTouchMove={markDirectScrollInput}
      >
        {skippedConflictNotice}
        <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const section = sections[virtualItem.index]
            if (!section) {
              return null
            }

            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                data-combined-diff-section-row
                data-combined-diff-section-key={section.key}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                // Why: position via top, not transform, so sticky file headers don't jump (transform creates a containing block).
                style={{ top: `${virtualItem.start}px` }}
              >
                <PierreDiffSection
                  section={section}
                  index={virtualItem.index}
                  isBranchMode={isBranchMode}
                  sideBySide={sideBySide}
                  worktreeId={file.worktreeId}
                  loadSection={loadSection}
                  loadDeferredSection={loadDeferredSection}
                  retrySection={retrySection}
                  toggleSection={toggleSection}
                  openSection={openSection}
                  openSectionTitle={
                    isAllMode || isBranchMode || isCommitMode ? 'Open diff' : 'Open in editor'
                  }
                  onOpenPreview={
                    canOpenDiffSectionPreviewToSide({
                      path: section.path,
                      status: section.status,
                      isCommitSurface: isCommitMode,
                      canOpenWorkspaceFileBrowser: canOpenWorkspaceFileBrowserForPath(
                        joinPath(file.filePath, section.path)
                      )
                    })
                      ? openSectionPreview
                      : undefined
                  }
                  workingDocumentId={workingDocumentIdsBySectionKey[section.key]}
                  onSave={async () => {
                    await handleSectionSaveRef.current(virtualItem.index)
                    return true
                  }}
                  renderHeaderTrailingContent={(currentSection) => {
                    const fileNoteCount = commentCountByFilePath.get(currentSection.path) ?? 0
                    return fileNoteCount > 0 ? (
                      <DiffNotesSendMenu
                        worktreeId={file.worktreeId}
                        groupId={activeGroupId ?? file.worktreeId}
                        comments={diffCommentsForWorktree}
                        filePath={currentSection.path}
                        showFileScope
                        triggerClassName="p-0.5 can-hover:opacity-0 group-hover:opacity-100"
                      />
                    ) : null
                  }}
                />
              </div>
            )
          })}
        </div>
      </div>
      {scrollThumb.visible && (
        <div
          aria-hidden="true"
          className="absolute inset-y-1 right-1 z-20 w-4 cursor-default rounded bg-muted/15 pl-1"
          onPointerDown={onScrollbarPointerDown}
        >
          <div
            data-combined-diff-scrollbar-thumb
            className="absolute left-1 right-0 rounded bg-muted-foreground/30"
            style={{ top: scrollThumb.top, height: scrollThumb.height }}
          />
        </div>
      )}
    </div>
  )
}
