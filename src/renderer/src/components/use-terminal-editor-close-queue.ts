import { useCallback } from 'react'
import { useAppStore } from '../store'
import { getEditorClosePlan } from '@renderer/store/slices/editor/working-document-state'
import { isPinnedActiveEditorTab } from './terminal-workspace-model'
import type {
  PendingEditorCloseState,
  TerminalEditorCloseFoundation
} from './use-terminal-editor-close-foundation'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'

export function useTerminalEditorCloseQueue(controller: TerminalEditorCloseFoundation) {
  const {
    activeWorktreeId,
    closeFile,
    closeUnifiedTab,
    pendingEditorCloseState,
    proceedToNativeWindowClose,
    setActiveFile,
    setActiveTabType,
    setActiveWorktree,
    setPendingEditorCloseState,
    windowCloseAfterDirtyRef
  } = controller

  const completeWindowCloseIfRequested = useCallback(() => {
    const pendingWindowClose = windowCloseAfterDirtyRef.current
    if (!pendingWindowClose) {
      return
    }
    windowCloseAfterDirtyRef.current = null
    proceedToNativeWindowClose(pendingWindowClose.isQuitting)
  }, [proceedToNativeWindowClose, windowCloseAfterDirtyRef])

  const advanceEditorCloseQueue = useCallback(
    (requestedState: PendingEditorCloseState | null = pendingEditorCloseState) => {
      if (!requestedState) {
        completeWindowCloseIfRequested()
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
          if (
            Object.values(useAppStore.getState().unifiedTabsByWorktree ?? {}).some((tabs) =>
              tabs.some((tab) => tab.id === tabId)
            )
          ) {
            closeUnifiedTab(tabId)
          } else {
            closeFile(tabId)
          }
        }
        setPendingEditorCloseState(null)
        completeWindowCloseIfRequested()
        return
      }

      const nextState: PendingEditorCloseState = {
        tabIds: plan.tabIds,
        pendingDocumentIds: plan.dirtyDocumentIds,
        currentDocumentId: nextDocumentId
      }
      const nextTabId = nextState.tabIds.find((tabId) =>
        (useAppStore.getState().workingDocumentIdsByTab[tabId] ?? []).includes(nextDocumentId)
      )
      const nextTab = nextTabId
        ? (() => {
            const unifiedTab = Object.values(useAppStore.getState().unifiedTabsByWorktree ?? {})
              .flat()
              .find((tab) => tab.id === nextTabId)
            return useAppStore
              .getState()
              .openFiles.find((file) => file.id === (unifiedTab?.entityId ?? nextTabId))
          })()
        : undefined
      if (nextTab && nextTab.worktreeId !== useAppStore.getState().activeWorktreeId) {
        setActiveWorktree(nextTab.worktreeId)
      }
      if (nextTab) {
        setActiveFile(nextTab.id)
        setActiveTabType('editor')
      }
      setPendingEditorCloseState(nextState)
    },
    [
      closeFile,
      closeUnifiedTab,
      completeWindowCloseIfRequested,
      pendingEditorCloseState,
      setActiveFile,
      setActiveTabType,
      setActiveWorktree,
      setPendingEditorCloseState
    ]
  )

  const queueEditorCloseRequests = useCallback(
    (tabIds: readonly string[], pendingWindowClose?: { isQuitting: boolean }) => {
      if (pendingWindowClose) {
        windowCloseAfterDirtyRef.current = pendingWindowClose
      }
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
    [
      advanceEditorCloseQueue,
      pendingEditorCloseState,
      setPendingEditorCloseState,
      windowCloseAfterDirtyRef
    ]
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

  const cancelEditorCloseQueue = useCallback(() => {
    windowCloseAfterDirtyRef.current = null
    setPendingEditorCloseState(null)
  }, [setPendingEditorCloseState, windowCloseAfterDirtyRef])

  const handleCloseFile = useCallback(
    (tabId: string) => {
      const state = useAppStore.getState()
      if (activeWorktreeId && isPinnedActiveEditorTab(state, activeWorktreeId, tabId)) {
        return
      }
      queueEditorCloseRequests([tabId])
    },
    [activeWorktreeId, queueEditorCloseRequests]
  )

  return {
    advanceEditorCloseQueue,
    cancelEditorCloseQueue,
    completeEditorCloseForDocument,
    handleCloseFile,
    queueEditorCloseRequests
  }
}

export type TerminalEditorCloseQueueController = TerminalEditorCloseFoundation &
  ReturnType<typeof useTerminalEditorCloseQueue>
