import { useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '../store'
import {
  ORCA_EDITOR_REQUEST_TAB_CLOSE_EVENT,
  type EditorRequestTabCloseDetail,
  quiesceDocumentSave,
  requestEditorDocumentSave
} from './editor/editor-autosave'
import { getEditorClosePlan } from '@renderer/store/slices/editor/working-document-state'
import { translate } from '@/i18n/i18n'
import type { TerminalEditorCloseQueueController } from './use-terminal-editor-close-queue'

export function useTerminalEditorCloseDialogActions(
  controller: TerminalEditorCloseQueueController
) {
  const {
    cancelEditorCloseQueue,
    completeEditorCloseForDocument,
    discardWorkingDocument,
    inFlightSaveDocumentIdRef,
    isClosingRef,
    pendingEditorCloseState,
    queueEditorCloseRequests,
    releaseCloseDialogGuardAfterDebounce
  } = controller

  const handleSaveDialogSave = useCallback(async () => {
    const documentId = pendingEditorCloseState?.currentDocumentId
    if (isClosingRef.current || !documentId) {
      return
    }
    const document = useAppStore.getState().workingDocuments[documentId]
    if (!document) {
      completeEditorCloseForDocument(documentId)
      return
    }

    isClosingRef.current = true
    inFlightSaveDocumentIdRef.current = documentId
    try {
      await requestEditorDocumentSave({ documentId })
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate(
              'auto.components.Terminal.a2a279b32a',
              'Save timed out or failed. Fix errors before closing.'
            )
      )
      isClosingRef.current = false
      return
    } finally {
      if (inFlightSaveDocumentIdRef.current === documentId) {
        inFlightSaveDocumentIdRef.current = null
      }
    }

    const state = useAppStore.getState()
    const plan = getEditorClosePlan(state, pendingEditorCloseState.tabIds)
    if (!plan.dirtyDocumentIds.includes(documentId)) {
      completeEditorCloseForDocument(documentId)
    }
    // A new edit during the write stays dirty and leaves the dialog open. The user must make a
    // fresh choice for the canonical revision rather than silently closing it after its save.
    releaseCloseDialogGuardAfterDebounce()
  }, [
    completeEditorCloseForDocument,
    inFlightSaveDocumentIdRef,
    isClosingRef,
    pendingEditorCloseState,
    releaseCloseDialogGuardAfterDebounce
  ])

  const handleSaveDialogDiscard = useCallback(async () => {
    const documentId = pendingEditorCloseState?.currentDocumentId
    if (isClosingRef.current || !documentId) {
      return
    }
    const document = useAppStore.getState().workingDocuments[documentId]
    if (!document) {
      completeEditorCloseForDocument(documentId)
      return
    }

    isClosingRef.current = true
    const revision = document.revision
    try {
      await quiesceDocumentSave(documentId)
      const state = useAppStore.getState()
      const currentDocument = state.workingDocuments[documentId]
      const plan = getEditorClosePlan(state, pendingEditorCloseState.tabIds)
      if (!plan.dirtyDocumentIds.includes(documentId)) {
        completeEditorCloseForDocument(documentId)
        return
      }
      if (!currentDocument || currentDocument.revision !== revision) {
        // A serializer/editor accepted a newer revision while quiescing. Keep both the text and
        // the views so "Don't Save" cannot discard a change the user did not review.
        return
      }
      discardWorkingDocument(documentId)
      completeEditorCloseForDocument(documentId)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate(
              'auto.components.Terminal.a2a279b32a',
              'Save timed out or failed. Fix errors before closing.'
            )
      )
    } finally {
      releaseCloseDialogGuardAfterDebounce()
    }
  }, [
    completeEditorCloseForDocument,
    discardWorkingDocument,
    isClosingRef,
    pendingEditorCloseState,
    releaseCloseDialogGuardAfterDebounce
  ])

  const handleSaveDialogCancel = useCallback(() => {
    if (isClosingRef.current) {
      return
    }
    isClosingRef.current = true
    cancelEditorCloseQueue()
    releaseCloseDialogGuardAfterDebounce()
  }, [cancelEditorCloseQueue, isClosingRef, releaseCloseDialogGuardAfterDebounce])

  useEffect(() => {
    const onRequestEditorClose = (event: Event): void => {
      const tabId = (event as CustomEvent<EditorRequestTabCloseDetail>).detail?.tabId
      if (tabId) {
        queueEditorCloseRequests([tabId])
      }
    }
    window.addEventListener(
      ORCA_EDITOR_REQUEST_TAB_CLOSE_EVENT,
      onRequestEditorClose as EventListener
    )
    return () =>
      window.removeEventListener(
        ORCA_EDITOR_REQUEST_TAB_CLOSE_EVENT,
        onRequestEditorClose as EventListener
      )
  }, [queueEditorCloseRequests])

  return { handleSaveDialogSave, handleSaveDialogDiscard, handleSaveDialogCancel }
}

export type TerminalEditorCloseController = TerminalEditorCloseQueueController &
  ReturnType<typeof useTerminalEditorCloseDialogActions>
