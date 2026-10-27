import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useFileOwnerRuntimeTarget } from '@/runtime/use-worktree-runtime-target'
import { useEditorState, type Editor } from '@tiptap/react'
import type { DiffComment } from '../../../../shared/diff-comment-types'
import { useAppStore } from '@/store'
import { selectWorktreeDiffComments } from '@/store/worktree-diff-comments-selector'
import { useLocalImagePick } from './useLocalImagePick'
import { useRichMarkdownSearch } from './useRichMarkdownSearch'
import type { LinkBubbleState } from './RichMarkdownLinkBubble'
import { useLinkBubble } from './useLinkBubble'
import { useEditorScrollRestore } from './useEditorScrollRestore'
import { useModifierHeldClass } from './useModifierHeldClass'
import { useRichMarkdownTableOfContents } from './use-rich-markdown-table-of-contents'
import { RichMarkdownEditorPresentation } from './RichMarkdownEditorPresentation'
import { useRichMarkdownEditorInstance } from './useRichMarkdownEditorInstance'
import { useRichMarkdownMenuController } from './useRichMarkdownMenuController'
import { useRichMarkdownProgrammaticSync } from './useRichMarkdownProgrammaticSync'
import { useRichMarkdownReconcileRoundTrip } from './useRichMarkdownReconcileRoundTrip'
import { useRichMarkdownPendingSerialization } from './useRichMarkdownPendingSerialization'
import { useRichMarkdownReviewController } from './useRichMarkdownReviewController'
import { useRichMarkdownReviewEditorEffects } from './useRichMarkdownReviewEditorEffects'
import {
  isRichMarkdownContextCommandTarget,
  isRichMarkdownTableContextCommand,
  runRichMarkdownContextCommand
} from './rich-markdown-context-command-routing'
import { useRichMarkdownSpellcheckAttribute } from './rich-markdown-spellcheck'
import { useRichMarkdownPendingFocus } from './useRichMarkdownPendingFocus'
import { useRichMarkdownSuperscriptLinkSetup } from './useRichMarkdownSuperscriptLinkSetup'
import {
  formatSelectedHtmlSuperscriptLinkStatus,
  getSelectedHtmlSuperscriptLinkStatus
} from './rich-markdown-selected-link-actions'
import type { RichMarkdownEditorProps } from './rich-markdown-editor-props'

export default function RichMarkdownEditor({
  fileId,
  documentId,
  documentRevision,
  viewStateId,
  content,
  filePath,
  worktreeId,
  externalSshTargetId,
  runtimeEnvironmentId,
  scrollCacheKey,
  onContentChange,
  onSave,
  onOpenDocLink,
  markdownDocuments,
  showTableOfContents = false,
  onCloseTableOfContents,
  markdownAnnotationsEnabled = false,
  markdownAnnotationFilePath,
  markdownSourceLineOffset = 0,
  markdownReviewContent = content,
  headerSlot
}: RichMarkdownEditorProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const richMarkdownSpellcheckEnabled = useAppStore(
    (s) => s.settings?.richMarkdownSpellcheckEnabled ?? true
  )
  const runtimeTarget = useFileOwnerRuntimeTarget(worktreeId, runtimeEnvironmentId)
  const editorFontZoomLevel = useAppStore((s) => s.editorFontZoomLevel)
  const activateMarkdownLink = useAppStore((s) => s.activateMarkdownLink)
  const addDiffComment = useAppStore((s) => s.addDiffComment)
  const deleteDiffComment = useAppStore((s) => s.deleteDiffComment)
  const updateDiffComment = useAppStore((s) => s.updateDiffComment)
  const clearDeliveredDiffComments = useAppStore((s) => s.clearDeliveredDiffComments)
  const allDiffComments = useAppStore((s): DiffComment[] | undefined =>
    selectWorktreeDiffComments(s, worktreeId)
  )
  const { codec, htmlSuperscriptLinkContext, worktreeRoot } = useRichMarkdownSuperscriptLinkSetup({
    filePath,
    runtimeEnvironmentId,
    worktreeId
  })
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const menu = useRichMarkdownMenuController({ markdownDocuments })
  const isMac = navigator.userAgent.includes('Mac')
  const lastCommittedMarkdownRef = useRef(content)
  // Keep raw source and canonical baselines for three-way reconciliation that preserves untouched formatting.
  const originalSourceRef = useRef(content)
  const baseCanonicalRef = useRef('')
  const onContentChangeRef = useRef(onContentChange)
  const onSaveRef = useRef(onSave)
  const onOpenDocLinkRef = useRef(onOpenDocLink)
  const handleLocalImagePickRef = useRef<() => void>(() => {})
  const openSearchRef = useRef<() => void>(() => {})
  const openAnnotationPopoverRef = useRef<(requireLiveSelection?: boolean) => boolean>(() => false)
  // Read the live instance because ProseMirror retains the first handleKeyDown closure, whose editor was null.
  const editorRef = useRef<Editor | null>(null)
  const synchronizedDocumentRevisionRef = useRef(documentRevision)
  const [synchronizedDocumentRevision, setSynchronizedDocumentRevision] = useState(documentRevision)
  const cancelAutoFocusRef = useRef<(() => void) | null>(null)
  // onCreate repairs emit onUpdate; suppress them so initialization cannot mark untouched files dirty.
  const isInitializingRef = useRef(true)
  // Ignore maintenance transactions from reloads, repairs and image refreshes so split panes cannot dirty shared content without user edits.
  const isApplyingProgrammaticUpdateRef = useRef(false)
  const [linkBubble, setLinkBubble] = useState<LinkBubbleState | null>(null)
  const [isEditingLink, setIsEditingLink] = useState(false)
  const isEditingLinkRef = useRef(false)
  const typedEmptyOrderedListMarkerRef = useRef(false)
  const review = useRichMarkdownReviewController({
    addDiffComment,
    allDiffComments,
    content,
    editorRef,
    filePath,
    markdownAnnotationFilePath,
    markdownAnnotationsEnabled,
    markdownReviewContent,
    markdownSourceLineOffset,
    rootRef,
    scrollContainerRef,
    worktreeId,
    worktreeRoot
  })
  const { tableOfContentsItems, navigateToTableOfContentsItem } = useRichMarkdownTableOfContents(
    showTableOfContents,
    content,
    scrollContainerRef
  )

  // Refresh callbacks during render so ProseMirror handlers cannot observe a passive-effect delay.
  onContentChangeRef.current = onContentChange
  onSaveRef.current = onSave
  onOpenDocLinkRef.current = onOpenDocLink
  isEditingLinkRef.current = isEditingLink
  openAnnotationPopoverRef.current = review.openAnnotationPopover
  const reconcileRoundTripRef = useRichMarkdownReconcileRoundTrip({
    htmlSuperscriptLinkContext,
    filePath,
    externalSshTargetId,
    runtimeEnvironmentId,
    worktreeId,
    worktreeRoot
  })
  const markDocumentSynchronized = useCallback(() => {
    synchronizedDocumentRevisionRef.current = documentRevision
    setSynchronizedDocumentRevision((current) =>
      current === documentRevision ? current : documentRevision
    )
  }, [documentRevision])

  const { serializeTimerRef, pendingEditEpochRef, flushPendingSerialization, flushOnFocusLeave } =
    useRichMarkdownPendingSerialization({
      fileId,
      documentId,
      surfaceId: `rich-markdown:${viewStateId}`,
      synchronizedRevision: synchronizedDocumentRevision,
      synchronizedRevisionRef: synchronizedDocumentRevisionRef,
      editorRef,
      lastCommittedMarkdownRef,
      originalSourceRef,
      baseCanonicalRef,
      onContentChangeRef,
      reconcileRoundTripRef
    })

  const { clearTransientReviewState } = review
  const setRootElement = useCallback(
    (node: HTMLDivElement | null) => {
      if (node === null) {
        // Release root-owned transient resources on detach instead of waiting for passive cleanup.
        clearTransientReviewState()
        cancelAutoFocusRef.current?.()
        cancelAutoFocusRef.current = null
        window.api.ui.setMarkdownEditorFocused(false)
      }
      rootRef.current = node
    },
    [clearTransientReviewState]
  )

  const editor = useRichMarkdownEditorInstance({
    codec,
    htmlSuperscriptLinkContext,
    content,
    filePath,
    worktreeId,
    worktreeRoot,
    externalSshTargetId,
    runtimeEnvironmentId,
    isMac,
    richMarkdownSpellcheckEnabled,
    runtimeTarget,
    activateMarkdownLink,
    rootRef,
    editorRef,
    lastCommittedMarkdownRef,
    originalSourceRef,
    baseCanonicalRef,
    onSaveRef,
    onOpenDocLinkRef,
    isEditingLinkRef,
    slashMenuRef: menu.slashMenuRef,
    filteredSlashCommandsRef: menu.filteredSlashCommandsRef,
    selectedCommandIndexRef: menu.selectedCommandIndexRef,
    docLinkMenuRef: menu.docLinkMenuRef,
    filteredDocLinkRowsRef: menu.filteredDocLinkRowsRef,
    selectedDocLinkIndexRef: menu.selectedDocLinkIndexRef,
    handleLocalImagePickRef,
    handleEmojiPickRef: menu.handleEmojiPickRef,
    typedEmptyOrderedListMarkerRef,
    cancelAutoFocusRef,
    fileId,
    serializeTimerRef,
    pendingEditEpochRef,
    isInitializingRef,
    isApplyingProgrammaticUpdateRef,
    markdownCommentsRef: review.markdownCommentsRef,
    markdownSourceLineOffsetRef: review.markdownSourceLineOffsetRef,
    flushPendingSerialization,
    openSearchRef,
    openAnnotationPopoverRef,
    syncAnnotationTarget: review.syncAnnotationTarget,
    clearAnnotationTarget: review.clearAnnotationTarget,
    scrollRichMarkdownReviewNoteCardIntoView: review.scrollRichMarkdownReviewNoteCardIntoView,
    setIsEditingLink,
    setLinkBubble,
    setSelectedCommandIndex: menu.setSelectedCommandIndex,
    setSelectedDocLinkIndex: menu.setSelectedDocLinkIndex,
    setSlashMenu: menu.setSlashMenu,
    setDocLinkMenu: menu.setDocLinkMenu
  })

  useRichMarkdownPendingFocus({
    editor,
    fileId,
    viewStateId,
    worktreeId,
    rootRef,
    cancelAutoFocusRef
  })

  // useEditor does not rerender per transaction; subscribe to citation selection so aria status follows NodeSelections.
  const selectedCitationStatus = useEditorState({
    editor,
    selector: (snapshot) =>
      getSelectedHtmlSuperscriptLinkStatus(snapshot.editor, htmlSuperscriptLinkContext)
  })
  useRichMarkdownSpellcheckAttribute(editor, richMarkdownSpellcheckEnabled)

  useEditorScrollRestore(scrollContainerRef, scrollCacheKey, editor)

  useModifierHeldClass(rootRef, isMac)

  useRichMarkdownReviewEditorEffects({
    canAnnotateRichMarkdown: review.canAnnotateRichMarkdown,
    content,
    editor,
    markdownComments: review.markdownComments,
    markdownSourceLineOffset,
    scrollContainerRef,
    syncAnnotationTarget: review.syncAnnotationTarget
  })

  useRichMarkdownProgrammaticSync({
    codec,
    content,
    docLinkMenuSetter: menu.setDocLinkMenu,
    editor,
    fileId,
    filePath,
    externalSshTargetId,
    isApplyingProgrammaticUpdateRef,
    lastCommittedMarkdownRef,
    onContentChangeRef,
    originalSourceRef,
    baseCanonicalRef,
    markdownDocuments,
    onContentSynchronized: markDocumentSynchronized,
    rootRef,
    runtimeTarget,
    serializeTimerRef,
    pendingEditEpochRef,
    slashMenuSetter: menu.setSlashMenu,
    worktreeId,
    worktreeRoot
  })

  const handleLocalImagePick = useLocalImagePick(editor, filePath, worktreeId, runtimeEnvironmentId)
  handleLocalImagePickRef.current = handleLocalImagePick

  const linkBubbleController = useLinkBubble(
    editor,
    rootRef,
    linkBubble,
    setLinkBubble,
    setIsEditingLink,
    {
      sourceFilePath: filePath,
      worktreeId,
      worktreeRoot,
      runtimeEnvironmentId,
      htmlSuperscriptLinkContext
    }
  )

  useEffect(() => {
    return window.api.ui.onRichMarkdownContextCommand((payload) => {
      const ed = editorRef.current
      if (
        !ed ||
        isRichMarkdownTableContextCommand(payload.command) ||
        !isRichMarkdownContextCommandTarget(payload, rootRef.current)
      ) {
        return
      }

      runRichMarkdownContextCommand({
        payload,
        editor: ed,
        toggleLink: linkBubbleController.toggleLinkFromToolbar,
        pickImage: handleLocalImagePick
      })
    })
  }, [handleLocalImagePick, linkBubbleController.toggleLinkFromToolbar])

  const { openSearch, searchState, searchActions } = useRichMarkdownSearch({
    editor,
    rootRef,
    scrollContainerRef
  })
  openSearchRef.current = openSearch

  return (
    <RichMarkdownEditorPresentation
      editor={editor}
      editorFontZoomLevel={editorFontZoomLevel}
      rootElement={rootRef.current}
      rootRef={setRootElement}
      onFocusLeave={flushOnFocusLeave}
      scrollContainerRef={scrollContainerRef}
      headerSlot={headerSlot}
      review={review}
      markdownReviewContent={markdownReviewContent}
      worktreeId={worktreeId}
      filePath={filePath}
      menu={menu}
      markdownSourceLineOffset={markdownSourceLineOffset}
      tableOfContentsItems={tableOfContentsItems}
      showTableOfContents={showTableOfContents}
      searchState={searchState}
      searchActions={searchActions}
      citationStatus={
        selectedCitationStatus
          ? formatSelectedHtmlSuperscriptLinkStatus(selectedCitationStatus)
          : ''
      }
      linkBubbleOwnerId={codec.transport.key}
      linkBubble={linkBubble}
      isEditingLink={isEditingLink}
      handleLocalImagePick={handleLocalImagePick}
      linkBubbleController={linkBubbleController}
      setLinkBubble={setLinkBubble}
      setIsEditingLink={setIsEditingLink}
      clearDeliveredDiffComments={clearDeliveredDiffComments}
      deleteDiffComment={deleteDiffComment}
      updateDiffComment={updateDiffComment}
      navigateToTableOfContentsItem={navigateToTableOfContentsItem}
      onCloseTableOfContents={onCloseTableOfContents}
    />
  )
}
