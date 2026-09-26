import React from 'react'
import type { Virtualizer } from '@tanstack/react-virtual'
import { PierreDiffSection } from '@/components/pierre-diff/PierreDiffSection'
import { translate } from '@/i18n/i18n'
import type { DecoratedDiffComment } from '@/components/diff-comments/decorated-diff-comment'
import { CombinedDiffFileTree } from '../../editor/combined-diff/browse-files/combined-diff-file-tree'
import type { DiffSection } from '@/components/editor/diff-section-types'
import type { CombinedDiffFileTreeEntry } from '../../editor/combined-diff/resolve-changes/combined-diff-section-identity'
import type { GitHubPRFile } from '../../../../../shared/github/pull-request-types'
import type { GitBranchChangeEntry } from '../../../../../shared/git-diff-compare-types'
import { PRFilesCombinedDiffToolbar } from './pr-files-combined-diff-toolbar'

export function PRFilesCombinedDiffBody({
  files,
  repoPath,
  repoId,
  prNumber,
  fileTreeCollapsed,
  allSectionsCollapsed,
  sideBySide,
  setFileTreeCollapsed,
  setAllSectionsCollapsed,
  setSideBySide,
  entries,
  sectionIndexByKey,
  activeTreeSectionKey,
  viewedSectionKeys,
  handleTreeNavigate,
  scrollContainerRef,
  virtualizer,
  sections,
  inlineReviewComments,
  loadSection,
  retrySection,
  toggleSection,
  openFilesOnGitHub,
  renderViewedCheckbox,
  handleAddLineComment,
  getCommentableLineNumbers
}: {
  files: GitHubPRFile[]
  repoPath: string
  repoId: string
  prNumber: number
  fileTreeCollapsed: boolean
  allSectionsCollapsed: boolean
  sideBySide: boolean
  setFileTreeCollapsed: (next: boolean) => void
  setAllSectionsCollapsed: (next: boolean) => void
  setSideBySide: React.Dispatch<React.SetStateAction<boolean>>
  entries: GitBranchChangeEntry[]
  sectionIndexByKey: Map<string, number>
  activeTreeSectionKey: string | null
  viewedSectionKeys: Set<string>
  handleTreeNavigate: (entry: CombinedDiffFileTreeEntry) => void
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  virtualizer: Virtualizer<HTMLDivElement, Element>
  sections: DiffSection[]
  inlineReviewComments: DecoratedDiffComment[]
  loadSection: (index: number) => void
  retrySection: (index: number) => void
  toggleSection: (index: number) => void
  openFilesOnGitHub: () => void
  renderViewedCheckbox: (section: DiffSection) => React.ReactNode
  handleAddLineComment: (
    section: DiffSection,
    args: { lineNumber: number; startLine?: number; body: string }
  ) => Promise<boolean>
  // Why: a stable callback, not an inline arrow — this re-keys every mounted row's comment decorator.
  getCommentableLineNumbers: (section: DiffSection) => readonly number[] | undefined
}): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <PRFilesCombinedDiffToolbar
        files={files}
        fileTreeCollapsed={fileTreeCollapsed}
        allSectionsCollapsed={allSectionsCollapsed}
        sideBySide={sideBySide}
        onShowFileTree={() => setFileTreeCollapsed(false)}
        onToggleAllCollapsed={() => setAllSectionsCollapsed(!allSectionsCollapsed)}
        onToggleSideBySide={() => setSideBySide((prev) => !prev)}
      />
      <div className="flex min-h-0 flex-1">
        <CombinedDiffFileTree
          mode="commit"
          worktreePath={repoPath}
          entries={entries}
          sectionIndexByKey={sectionIndexByKey}
          activeSectionKey={activeTreeSectionKey}
          viewedSectionKeys={viewedSectionKeys}
          collapsed={fileTreeCollapsed}
          onCollapsedChange={setFileTreeCollapsed}
          onNavigate={handleTreeNavigate}
        />
        <div ref={scrollContainerRef} className="min-w-0 flex-1 overflow-auto scrollbar-editor">
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
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 w-full"
                  style={{ top: `${virtualItem.start}px` }}
                >
                  <PierreDiffSection
                    section={section}
                    index={virtualItem.index}
                    isBranchMode={false}
                    sideBySide={sideBySide}
                    worktreeId={`github-pr:${repoId}:${prNumber}`}
                    inlineComments={inlineReviewComments}
                    loadSection={loadSection}
                    retrySection={retrySection}
                    toggleSection={toggleSection}
                    openSection={openFilesOnGitHub}
                    openSectionTitle={translate(
                      'auto.components.GitHubItemDialog.85a2b66f54',
                      'Open files on GitHub'
                    )}
                    renderHeaderTrailingContent={renderViewedCheckbox}
                    onAddLineComment={handleAddLineComment}
                    addLineCommentLabel={translate(
                      'auto.components.GitHubItemDialog.bf43425540',
                      'Comment'
                    )}
                    getCommentableLineNumbers={getCommentableLineNumbers}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
