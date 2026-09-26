import React, { useCallback, useEffect, useRef, useState } from 'react'
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
import { registerPendingEditorFlush } from './editor-pending-flush'
import { useRichMarkdownTableOfContents } from './use-rich-markdown-table-of-contents'
import { RichMarkdownEditorPresentation } from './RichMarkdownEditorPresentation'
import { useRichMarkdownEditorInstance } from './useRichMarkdownEditorInstance'
import { useRichMarkdownMenuController } from './useRichMarkdownMenuController'
import { useRichMarkdownProgrammaticSync } from './useRichMarkdownProgrammaticSync'
import { useRichMarkdownReconcileRoundTrip } from './useRichMarkdownReconcileRoundTrip'
import { commitRichMarkdownSerialization } from './rich-markdown-serialization-commit'
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
  const settings = useAppStore((s) => s.settings)
  const richMarkdownSpellcheckEnabled = settings?.richMarkdownSpellcheckEnabled ?? true
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
  // Why: three-way source-preserving reconciliation baseline — the raw on-disk
  // bytes and their canonical serialization — so edits patch onto the original
  // style rather than re-canonicalizing untouched regions (#6080).
  const originalSourceRef = useRef(content)
  const baseCanonicalRef = useRef('')
  const onContentChangeRef = useRef(onContentChange)
  const onSaveRef = useRef(onSave)
  const onOpenDocLinkRef = useRef(onOpenDocLink)
  const handleLocalImagePickRef = useRef<() => void>(() => {})
  const openSearchRef = useRef<() => void>(() => {})
  const openAnnotationPopoverRef = useRef<(requireLiveSelection?: boolean) => boolean>(() => false)
  // Why: ProseMirror keeps the initial handleKeyDown closure, so `editor` stays
  // stuck at the first-render null value unless we read the live instance here.
  const editorRef = useRef<Editor | null>(null)
  const synchronizedDocumentRevisionRef = useRef(documentRevision)
  const [synchronizedDocumentRevision, setSynchronizedDocumentRevision] = useState(documentRevision)
  const cancelAutoFocusRef = useRef<(() => void) | null>(null)
  const serializeTimerRef = useRef<number | null>(null)
  // Why: empty-list repair dispatches a ProseMirror transaction inside onCreate
  // which triggers onUpdate. Without this guard the editor immediately marks the
  // file dirty before the user has typed anything.
  const isInitializingRef = useRef(true)
  // Why: internal maintenance paths can dispatch transactions after mount
  // (external reloads, empty-list repair, image-path refresh). Those
  // are not user edits, so onUpdate must ignore them or split panes can flip a
  // shared file dirty without any real content change.
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

  // Why: assigning callback refs during render keeps them current before any
  // ProseMirror handler reads them, avoiding the one-render stale window that
  // useEffect would introduce. Refs are mutable and never trigger re-renders.
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

  const flushPendingSerialization = useCallback(() => {
    if (serializeTimerRef.current === null) {
      return
    }
    window.clearTimeout(serializeTimerRef.current)
    serializeTimerRef.current = null
    if (
      useAppStore.getState().workingDocuments[documentId]?.revision !==
      synchronizedDocumentRevisionRef.current
    ) {
      return
    }
    try {
      const { markdown, didSerialize } = commitRichMarkdownSerialization(
        editorRef.current,
        { originalSourceRef, baseCanonicalRef, lastCommittedMarkdownRef },
        reconcileRoundTripRef.current
      )
      if (didSerialize) {
        onContentChangeRef.current(markdown)
      }
    } catch (error) {
      // Why: teardown and reconcile failures are handled above; other failures must stay observable.
      console.error('[editor] rich markdown serialize (flush) failed', error)
    }
  }, [documentId, reconcileRoundTripRef])

  useEffect(() => {
    // A serialized rich editor is a producer for this canonical document, not a
    // tab-local draft. Its registration stays on the source revision that its
    // ProseMirror document has actually synchronized.
    return registerPendingEditorFlush(
      documentId,
      `rich-markdown:${viewStateId}`,
      synchronizedDocumentRevision,
      flushPendingSerialization
    )
  }, [documentId, flushPendingSerialization, synchronizedDocumentRevision, viewStateId])

  const { clearTransientReviewState } = review
  const setRootElement = useCallback(
    (node: HTMLDivElement | null) => {
      if (node === null) {
        // Why: these transient editor resources are owned by this root; clearing
        // them at detach keeps unmount cleanup out of passive Effects.
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
    settings,
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
    serializeTimerRef,
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

  // Why: useEditor defaults shouldRerenderOnTransaction to false, so selection-only
  // citation NodeSelections would leave aria status stale without useEditorState.
  const selectedCitationStatus = useEditorState({
    editor,
    selector: (snapshot) =>
      getSelectedHtmlSuperscriptLinkStatus(snapshot.editor, htmlSuperscriptLinkContext)
  })
  useRichMarkdownSpellcheckAttribute(editor, richMarkdownSpellcheckEnabled)

  // Why: use useLayoutEffect (synchronous cleanup) so the pending serialization
  // flush runs before useEditor's cleanup destroys the editor instance on tab
  // switch or mode change. React runs layout-effect cleanups before effect
  // cleanups, guaranteeing the editor is still alive when we serialize.
  React.useLayoutEffect(() => {
    return flushPendingSerialization
  }, [flushPendingSerialization])

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
    originalSourceRef,
    baseCanonicalRef,
    markdownDocuments,
    onContentSynchronized: markDocumentSynchronized,
    rootRef,
    runtimeEnvironmentId,
    settings,
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
