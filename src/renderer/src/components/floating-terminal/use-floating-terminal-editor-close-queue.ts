import { useCallback, useRef, useState } from 'react'
import { quiesceDocumentSave, requestEditorDocumentSave } from '@/components/editor/editor-autosave'
import { getEditorClosePlan } from '@renderer/store/slices/editor/working-document-state'
import type { PendingEditorCloseState } from '@/components/use-terminal-editor-close-foundation'
import type { WorkingDocument, WorkingDocumentId } from '@/store/slices/editor/working-document'
import { useAppStore } from '@/store'
import type { FloatingTerminalPanelLocalState } from './use-floating-terminal-panel-local-state'
import type { FloatingTerminalPanelStoreState } from './use-floating-terminal-panel-store-state'

type FloatingTerminalEditorCloseQueueInput = Pick<
  FloatingTerminalPanelStoreState,
  'closeFile' | 'closeUnifiedTab' | 'discardWorkingDocument'
> &
  Pick<FloatingTerminalPanelLocalState, 'pendingReclaimArmByFileIdRef'>

export type FloatingTerminalEditorCloseQueue = {
  pendingEditorCloseState: PendingEditorCloseState | null
  saveDialogDocument: WorkingDocument | null
  queueEditorCloseRequests: (tabIds: readonly string[]) => void
  handleFloatingSaveDialogSave: () => Promise<void>
  handleFloatingSaveDialogDiscard: () => Promise<void>
  handleFloatingSaveDialogCancel: () => void
}

export function useFloatingTerminalEditorCloseQueue({
  closeFile,
  closeUnifiedTab,
  discardWorkingDocument,
  pendingReclaimArmByFileIdRef
}: FloatingTerminalEditorCloseQueueInput): FloatingTerminalEditorCloseQueue {
  const [pendingEditorCloseState, setPendingEditorCloseState] =
    useState<PendingEditorCloseState | null>(null)
  const isClosingRef = useRef(false)
  const saveDialogDocument = useAppStore((state) => {
    const documentId = pendingEditorCloseState?.currentDocumentId
    return documentId ? (state.workingDocuments[documentId] ?? null) : null
  })

  const closeTab = useCallback(
    (tabId: string) => {
      if (
        Object.values(useAppStore.getState().unifiedTabsByWorktree ?? {}).some((tabs) =>
          tabs.some((tab) => tab.id === tabId)
        )
      ) {
        closeUnifiedTab(tabId)
      } else {
        closeFile(tabId)
      }
      const reclaim = pendingReclaimArmByFileIdRef.current.get(tabId)
      pendingReclaimArmByFileIdRef.current.delete(tabId)
      reclaim?.()
    },
    [closeFile, closeUnifiedTab, pendingReclaimArmByFileIdRef]
  )

  const advanceEditorCloseQueue = useCallback(
    (requestedState: PendingEditorCloseState | null = pendingEditorCloseState) => {
      if (!requestedState) {
        return
      }
      const plan = getEditorClosePlan(useAppStore.getState(), requestedState.tabIds)
      const currentDocumentId =
        requestedState.currentDocumentId &&
        plan.dirtyDocumentIds.includes(requestedState.currentDocumentId)
          ? requestedState.currentDocumentId
          : null
      if (currentDocumentId) {
        setPendingEditorCloseState({
          tabIds: plan.tabIds,
          pendingDocumentIds: plan.dirtyDocumentIds,
          currentDocumentId
        })
        return
      }

      const nextDocumentId = plan.dirtyDocumentIds[0] ?? null
      if (!nextDocumentId) {
        for (const tabId of plan.tabIds) {
          closeTab(tabId)
        }
        setPendingEditorCloseState(null)
        return
      }
      setPendingEditorCloseState({
        tabIds: plan.tabIds,
        pendingDocumentIds: plan.dirtyDocumentIds,
        currentDocumentId: nextDocumentId
      })
    },
    [closeTab, pendingEditorCloseState]
  )

  const queueEditorCloseRequests = useCallback(
    (tabIds: readonly string[]) => {
      const queuedTabIds = pendingEditorCloseState
        ? [...pendingEditorCloseState.tabIds, ...tabIds]
        : tabIds
      const plan = getEditorClosePlan(useAppStore.getState(), queuedTabIds)
      const nextState: PendingEditorCloseState = {
        tabIds: plan.tabIds,
        pendingDocumentIds: plan.dirtyDocumentIds,
        currentDocumentId:
          pendingEditorCloseState?.currentDocumentId &&
          plan.dirtyDocumentIds.includes(pendingEditorCloseState.currentDocumentId)
            ? pendingEditorCloseState.currentDocumentId
            : null
      }
      setPendingEditorCloseState(nextState)
      advanceEditorCloseQueue(nextState)
    },
    [advanceEditorCloseQueue, pendingEditorCloseState]
  )

  const completeEditorCloseForDocument = useCallback(
    (documentId: WorkingDocumentId) => {
      if (!pendingEditorCloseState) {
        return
      }
      advanceEditorCloseQueue({
        ...pendingEditorCloseState,
        pendingDocumentIds: pendingEditorCloseState.pendingDocumentIds.filter(
          (pendingDocumentId) => pendingDocumentId !== documentId
        ),
        currentDocumentId: null
      })
    },
    [advanceEditorCloseQueue, pendingEditorCloseState]
  )

  const handleFloatingSaveDialogSave = useCallback(async () => {
    const documentId = pendingEditorCloseState?.currentDocumentId
    if (isClosingRef.current || !documentId) {
      return
    }
    if (!useAppStore.getState().workingDocuments[documentId]) {
      completeEditorCloseForDocument(documentId)
      return
    }
    isClosingRef.current = true
    try {
      await requestEditorDocumentSave({ documentId })
      const plan = getEditorClosePlan(useAppStore.getState(), pendingEditorCloseState.tabIds)
      if (!plan.dirtyDocumentIds.includes(documentId)) {
        completeEditorCloseForDocument(documentId)
      }
    } finally {
      isClosingRef.current = false
    }
  }, [completeEditorCloseForDocument, pendingEditorCloseState])

  const handleFloatingSaveDialogDiscard = useCallback(async () => {
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
      } else if (currentDocument && currentDocument.revision === revision) {
        discardWorkingDocument(documentId)
        completeEditorCloseForDocument(documentId)
      }
    } finally {
      isClosingRef.current = false
    }
  }, [completeEditorCloseForDocument, discardWorkingDocument, pendingEditorCloseState])

  const handleFloatingSaveDialogCancel = useCallback(() => {
    if (isClosingRef.current) {
      return
    }
    pendingReclaimArmByFileIdRef.current.clear()
    setPendingEditorCloseState(null)
  }, [pendingReclaimArmByFileIdRef])

  return {
    pendingEditorCloseState,
    saveDialogDocument,
    queueEditorCloseRequests,
    handleFloatingSaveDialogSave,
    handleFloatingSaveDialogDiscard,
    handleFloatingSaveDialogCancel
  }
}
