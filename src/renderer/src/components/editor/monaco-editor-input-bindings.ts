import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { editor } from 'monaco-editor'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { getMonacoCodebaseSearchQuery } from './monaco-codebase-search'
import { getDiffCommentPopoverLeft } from '../diff-comments/diff-comment-popover-position'
import {
  installEditorAddReviewNoteShortcut,
  installEditorAskAgentAboutSelectionShortcut,
  installEditorSaveShortcut,
  installMonacoEditorFindShortcut
} from './editor-shortcuts'
import {
  getMonacoMarkdownSelectionAnnotationTarget,
  type MonacoMarkdownSelectionAnnotationTarget
} from './monaco-markdown-selection-annotation'
import { handleMonacoLargeTextPaste } from './monaco-large-text-paste'
import { beginEditorLargePaste } from './editor-large-paste-in-flight'
import type { MarkdownCommentPopoverState } from './use-monaco-markdown-annotations'
import type { MonacoEditorPropsRef } from './monaco-editor-mount-params'

type MonacoEditorInputBindingsParams = {
  editorInstance: editor.IStandaloneCodeEditor
  worktreeId: string | undefined
  editorContainerRef: MutableRefObject<HTMLDivElement | null>
  propsRef: MonacoEditorPropsRef
  readOnlyRef: MutableRefObject<boolean>
  lastSyncedContentRef: MutableRefObject<string>
  isApplyingLargePasteRef: MutableRefObject<boolean>
  commentPopoverRef: MutableRefObject<MarkdownCommentPopoverState | null>
  shouldShowMarkdownAnnotationsRef: MutableRefObject<boolean>
  setCommentPopover: Dispatch<SetStateAction<MarkdownCommentPopoverState | null>>
  setSelectionAnnotationTarget: Dispatch<
    SetStateAction<MonacoMarkdownSelectionAnnotationTarget | null>
  >
  setAskAgentTarget: Dispatch<SetStateAction<MonacoMarkdownSelectionAnnotationTarget | null>>
}

// Share teardown so editor disposal preserves shortcut and paste cleanup order.
export function installMonacoEditorInputBindings(params: MonacoEditorInputBindingsParams): {
  disposeInputBindings: () => void
} {
  const {
    editorInstance,
    worktreeId,
    editorContainerRef,
    propsRef,
    readOnlyRef,
    lastSyncedContentRef,
    isApplyingLargePasteRef,
    commentPopoverRef,
    shouldShowMarkdownAnnotationsRef,
    setCommentPopover,
    setSelectionAnnotationTarget,
    setAskAgentTarget
  } = params

  const editorDomNode = editorInstance.getContainerDomNode()
  const cleanupSaveShortcut = installEditorSaveShortcut(editorDomNode, () => {
    const value = editorInstance.getValue()
    propsRef.current.onSave(value)
  })
  const cleanupFindShortcut = installMonacoEditorFindShortcut(editorInstance)
  const cleanupAddReviewNoteShortcut = installEditorAddReviewNoteShortcut(editorDomNode, () => {
    // Preserve open drafts during same-tick chords before the composer guard mounts.
    if (commentPopoverRef.current) {
      return true
    }
    if (!shouldShowMarkdownAnnotationsRef.current) {
      return false
    }
    // Read the live selection because the rendered annotation target lags by one render.
    const target = getMonacoMarkdownSelectionAnnotationTarget(
      editorInstance,
      editorInstance.getSelection(),
      getDiffCommentPopoverLeft(editorInstance, editorContainerRef.current) ?? undefined
    )
    if (!target) {
      return false
    }
    commentPopoverRef.current = target
    setCommentPopover(target)
    setSelectionAnnotationTarget(null)
    return true
  })
  // Shared by the context-menu action and the bindable chord; returns whether
  // the popover actually opened so the chord is only consumed on success.
  const openAskAgentPopover = (): boolean => {
    if (!worktreeId) {
      return false
    }
    const target = getMonacoMarkdownSelectionAnnotationTarget(
      editorInstance,
      editorInstance.getSelection(),
      getDiffCommentPopoverLeft(editorInstance, editorContainerRef.current) ?? undefined
    )
    if (!target) {
      return false
    }
    setAskAgentTarget(target)
    return true
  }
  const cleanupAskAgentShortcut = installEditorAskAgentAboutSelectionShortcut(
    editorDomNode,
    openAskAgentPopover
  )
  const askAgentAction = editorInstance.addAction({
    id: 'orca.askAgentAboutSelection',
    label: translate(
      'auto.components.editor.MonacoEditor.askAgentAboutSelection',
      'Ask Agent About Selection'
    ),
    precondition: 'editorHasSelection',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 3,
    run: () => {
      openAskAgentPopover()
    }
  })
  const searchInFilesAction = editorInstance.addAction({
    id: 'orca.searchInFiles',
    label: translate('auto.components.editor.MonacoEditor.fd68ae03b3', 'Search in Files'),
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 2,
    run: () => {
      if (!worktreeId) {
        return
      }
      const query = getMonacoCodebaseSearchQuery(
        editorInstance.getModel(),
        editorInstance.getSelection(),
        editorInstance.getPosition()
      )
      if (!query) {
        return
      }
      const state = useAppStore.getState()
      state.showRightSidebarSearch({ query })
    }
  })
  const onLargeTextPaste = (event: ClipboardEvent): void => {
    let endSaveDeferral: (() => void) | null = null
    handleMonacoLargeTextPaste(editorInstance, event, {
      readOnly: readOnlyRef.current,
      onPasteStart: () => {
        isApplyingLargePasteRef.current = true
        const modelUri = editorInstance.getModel()?.uri.toString()
        endSaveDeferral = modelUri ? beginEditorLargePaste(modelUri) : null
      },
      onPasteResult: (result) => {
        isApplyingLargePasteRef.current = false
        endSaveDeferral?.()
        if (result.status === 'pasted' || result.status === 'cancelled') {
          const value = editorInstance.getValue()
          lastSyncedContentRef.current = value
          propsRef.current.onContentChange(value)
        }
        if (result.status === 'rejected' && result.reason === 'too-large') {
          toast.error(
            translate(
              'auto.components.editor.MonacoEditor.largePasteTooLarge',
              'Paste is too large.'
            )
          )
        }
      }
    })
  }
  editorDomNode.addEventListener('paste', onLargeTextPaste, { capture: true })

  return {
    disposeInputBindings: () => {
      cleanupSaveShortcut()
      cleanupFindShortcut()
      cleanupAddReviewNoteShortcut()
      cleanupAskAgentShortcut()
      editorDomNode.removeEventListener('paste', onLargeTextPaste, { capture: true })
      searchInFilesAction.dispose()
      askAgentAction.dispose()
    }
  }
}
