import type React from 'react'
import type { ComponentProps } from 'react'
import type { Editor } from '@tiptap/react'
import { RichMarkdownEditorSurface } from './RichMarkdownEditorSurface'
import type { RichMarkdownEditorProps } from './rich-markdown-editor-props'
import type { LinkBubbleState } from './RichMarkdownLinkBubble'

type SurfaceProps = ComponentProps<typeof RichMarkdownEditorSurface>

type RichMarkdownMenuPresentation = Pick<
  SurfaceProps,
  | 'docLinkMenu'
  | 'docLinkRows'
  | 'docLinkTotalMatches'
  | 'emojiMenu'
  | 'filteredSlashCommands'
  | 'selectedCommandIndex'
  | 'selectedDocLinkIndex'
  | 'slashMenu'
> & {
  openEmojiMenu: SurfaceProps['onEmojiPick']
  setEmojiMenu: (menu: SurfaceProps['emojiMenu']) => void
}

type RichMarkdownReviewPresentation = Pick<
  SurfaceProps,
  | 'activeReviewCommentId'
  | 'annotationPopover'
  | 'annotationTarget'
  | 'attentionReviewCommentId'
  | 'copiedReviewNoteId'
  | 'notePositions'
  | 'reviewNotesCopied'
  | 'reviewRailExpanded'
  | 'reviewRailOpen'
  | 'reviewRailVisible'
  | 'unsentMarkdownReviewScope'
> & {
  clearAnnotationHighlight: () => void
  handleCopyMarkdownReviewNote: SurfaceProps['onCopyReviewNote']
  handleCopyMarkdownReviewNotes: () => Promise<void>
  markdownComments: unknown[]
  openAnnotationPopover: () => boolean
  scrollRichMarkdownReviewNoteSourceIntoView: SurfaceProps['onReviewNoteSourceClick']
  setAnnotationPopover: (target: SurfaceProps['annotationPopover']) => void
  setReviewRailOpen: (next: boolean | ((open: boolean) => boolean)) => void
  submitAnnotation: SurfaceProps['onSubmitAnnotation']
  syncNotePositions: SurfaceProps['onReviewNoteContentResize']
}

type RichMarkdownLinkBubbleController = {
  handleLinkCopy: () => void
  handleLinkEditCancel: () => void
  handleLinkOpen: () => void
  handleLinkRemove: () => void
  handleLinkSave: (href: string) => void
  toggleLinkFromToolbar: () => void
}

type RichMarkdownEditorPresentationProps = {
  editor: Editor | null
  editorFontZoomLevel: number
  rootElement: HTMLDivElement | null
  rootRef: ComponentProps<typeof RichMarkdownEditorSurface>['rootRef']
  scrollContainerRef: ComponentProps<typeof RichMarkdownEditorSurface>['scrollContainerRef']
  headerSlot: RichMarkdownEditorProps['headerSlot']
  review: RichMarkdownReviewPresentation
  markdownReviewContent: string
  worktreeId: string
  filePath: string
  menu: RichMarkdownMenuPresentation
  markdownSourceLineOffset: number
  tableOfContentsItems: ComponentProps<typeof RichMarkdownEditorSurface>['tableOfContentsItems']
  showTableOfContents: boolean
  searchState: ComponentProps<typeof RichMarkdownEditorSurface>['searchState']
  searchActions: ComponentProps<typeof RichMarkdownEditorSurface>['searchActions']
  citationStatus: string
  linkBubbleOwnerId: string
  linkBubble: LinkBubbleState | null
  isEditingLink: boolean
  handleLocalImagePick: () => void
  linkBubbleController: RichMarkdownLinkBubbleController
  setLinkBubble: (bubble: LinkBubbleState | null) => void
  setIsEditingLink: (editing: boolean) => void
  clearDeliveredDiffComments: (
    worktreeId: string,
    notes: Parameters<SurfaceProps['onReviewNotesDelivered']>[0]
  ) => void
  deleteDiffComment: (worktreeId: string, commentId: string) => void
  updateDiffComment: (worktreeId: string, commentId: string, body: string) => Promise<boolean>
  navigateToTableOfContentsItem: (id: string) => void
  onCloseTableOfContents: RichMarkdownEditorProps['onCloseTableOfContents']
}

export function RichMarkdownEditorPresentation({
  editor,
  editorFontZoomLevel,
  rootElement,
  rootRef,
  scrollContainerRef,
  headerSlot,
  review,
  markdownReviewContent,
  worktreeId,
  filePath,
  menu,
  markdownSourceLineOffset,
  tableOfContentsItems,
  showTableOfContents,
  searchState,
  searchActions,
  citationStatus,
  linkBubbleOwnerId,
  isEditingLink,
  linkBubble,
  handleLocalImagePick,
  linkBubbleController,
  setLinkBubble,
  setIsEditingLink,
  clearDeliveredDiffComments,
  deleteDiffComment,
  updateDiffComment,
  navigateToTableOfContentsItem,
  onCloseTableOfContents
}: RichMarkdownEditorPresentationProps): React.JSX.Element {
  return (
    <RichMarkdownEditorSurface
      editor={editor}
      editorFontZoomLevel={editorFontZoomLevel}
      rootElement={rootElement}
      rootRef={rootRef}
      scrollContainerRef={scrollContainerRef}
      headerSlot={headerSlot}
      reviewRailExpanded={review.reviewRailExpanded}
      reviewRailVisible={review.reviewRailVisible}
      notePositions={review.notePositions}
      activeReviewCommentId={review.activeReviewCommentId}
      attentionReviewCommentId={review.attentionReviewCommentId}
      copiedReviewNoteId={review.copiedReviewNoteId}
      markdownReviewContent={markdownReviewContent}
      worktreeId={worktreeId}
      filePath={filePath}
      markdownCommentsCount={review.markdownComments.length}
      reviewRailOpen={review.reviewRailOpen}
      reviewNotesCopied={review.reviewNotesCopied}
      unsentMarkdownReviewScope={review.unsentMarkdownReviewScope}
      linkBubble={linkBubble}
      isEditingLink={isEditingLink}
      slashMenu={menu.slashMenu}
      filteredSlashCommands={menu.filteredSlashCommands}
      selectedCommandIndex={menu.selectedCommandIndex}
      emojiMenu={menu.emojiMenu}
      docLinkMenu={menu.docLinkMenu}
      docLinkRows={menu.docLinkRows}
      docLinkTotalMatches={menu.docLinkTotalMatches}
      selectedDocLinkIndex={menu.selectedDocLinkIndex}
      annotationTarget={review.annotationTarget}
      annotationPopover={review.annotationPopover}
      markdownSourceLineOffset={markdownSourceLineOffset}
      tableOfContentsItems={tableOfContentsItems}
      showTableOfContents={showTableOfContents}
      searchState={searchState}
      searchActions={searchActions}
      citationStatus={citationStatus}
      linkBubbleOwnerId={linkBubbleOwnerId}
      linkBubbleActions={{
        dismissLinkBubble: () => {
          setLinkBubble(null)
          setIsEditingLink(false)
        },
        ...linkBubbleController,
        setIsEditingLink
      }}
      onToggleLink={linkBubbleController.toggleLinkFromToolbar}
      onImagePick={handleLocalImagePick}
      onEmojiPick={menu.openEmojiMenu}
      onCloseEmojiMenu={() => menu.setEmojiMenu(null)}
      onOpenAnnotationPopover={review.openAnnotationPopover}
      onCancelAnnotationPopover={() => {
        review.setAnnotationPopover(null)
        review.clearAnnotationHighlight()
      }}
      onSubmitAnnotation={review.submitAnnotation}
      onCopyReviewNotes={() => void review.handleCopyMarkdownReviewNotes()}
      onCopyReviewNote={(note) => void review.handleCopyMarkdownReviewNote(note)}
      onToggleReviewRail={() => review.setReviewRailOpen((open) => !open)}
      onReviewNotesDelivered={(notes) => void clearDeliveredDiffComments(worktreeId, notes)}
      onReviewNoteSourceClick={review.scrollRichMarkdownReviewNoteSourceIntoView}
      onDeleteReviewComment={(commentId) => void deleteDiffComment(worktreeId, commentId)}
      onSubmitReviewCommentEdit={(commentId, body) =>
        updateDiffComment(worktreeId, commentId, body)
      }
      onReviewNoteContentResize={review.syncNotePositions}
      onNavigateTableOfContentsItem={navigateToTableOfContentsItem}
      onCloseTableOfContents={onCloseTableOfContents}
    />
  )
}
