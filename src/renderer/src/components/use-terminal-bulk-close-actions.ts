import { useCallback } from 'react'
import { useAppStore } from '../store'
import { closeTerminalTab } from './terminal/terminal-tab-actions'
import { isWebRuntimeSessionActive } from '@/runtime/web-runtime-session'
import { closeBrowserWorkspaceTabOnHosts } from '@/runtime/browser-workspace-tab-close'
import { destroyWorkspaceWebviews } from '../store/slices/browser-webview-cleanup'
import {
  getActiveWorktreeRuntimeEnvironmentId,
  isPinnedEditorFileTab
} from './terminal-workspace-model'
import type { TerminalCloseController } from './use-terminal-close-actions'

export function useTerminalBulkCloseActions(controller: TerminalCloseController) {
  const { activeWorktreeId, closeBrowserTab, closeTab, queueEditorCloseRequests } = controller
  const closeTabBarTabs = useCallback(
    (tabIds: string[]) => {
      if (!activeWorktreeId) {
        return
      }
      const state = useAppStore.getState()
      const editorTabIds: string[] = []
      for (const id of tabIds) {
        const unifiedTab = (state.unifiedTabsByWorktree[activeWorktreeId] ?? []).find(
          (candidate) => candidate.id === id || candidate.entityId === id
        )
        if (unifiedTab?.isPinned) {
          continue
        }
        let browserCloseOptions: { reason: 'cleanup' } | undefined
        if (unifiedTab?.contentType === 'browser') {
          const plan = closeBrowserWorkspaceTabOnHosts({
            state,
            worktreeId: activeWorktreeId,
            workspaceId: unifiedTab.entityId,
            visibleTabId: unifiedTab.id,
            focusedEnvironmentId: getActiveWorktreeRuntimeEnvironmentId(activeWorktreeId)
          })
          if (!plan.closesLocally) {
            if (plan.removesVisibleTab) {
              state.closeUnifiedTab(unifiedTab.id)
            }
            continue
          }
          browserCloseOptions = plan.localCloseReason
            ? { reason: plan.localCloseReason }
            : undefined
        }
        if (
          unifiedTab?.contentType === 'terminal' &&
          isWebRuntimeSessionActive(getActiveWorktreeRuntimeEnvironmentId(activeWorktreeId))
        ) {
          closeTerminalTab(unifiedTab.entityId, { skipRunningProcessConfirm: true })
          continue
        }
        if (
          unifiedTab &&
          ['editor', 'diff', 'conflict-review', 'check-details'].includes(unifiedTab.contentType)
        ) {
          editorTabIds.push(unifiedTab.id)
          continue
        }
        if ((state.tabsByWorktree[activeWorktreeId] ?? []).some((tab) => tab.id === id)) {
          closeTab(id)
        } else if (
          state.openFiles.some((file) => file.worktreeId === activeWorktreeId && file.id === id)
        ) {
          editorTabIds.push(id)
          continue
        } else if (
          (state.browserTabsByWorktree[activeWorktreeId] ?? []).some((tab) => tab.id === id)
        ) {
          closeBrowserTab(id, browserCloseOptions)
          // closeBrowserTab announces the MRU target before guest teardown can trigger bridge fallback.
          destroyWorkspaceWebviews(state.browserPagesByWorkspace, id)
        } else if (unifiedTab?.contentType === 'simulator') {
          state.closeUnifiedTab(unifiedTab.id)
        }
      }
      if (editorTabIds.length > 0) {
        queueEditorCloseRequests(editorTabIds)
      }
    },
    [activeWorktreeId, closeBrowserTab, closeTab, queueEditorCloseRequests]
  )

  const handleCloseOthers = useCallback(
    (tabId: string) => {
      if (!activeWorktreeId) {
        return
      }
      const order = useAppStore.getState().tabBarOrderByWorktree[activeWorktreeId] ?? []
      closeTabBarTabs(order.filter((id) => id !== tabId))
    },
    [activeWorktreeId, closeTabBarTabs]
  )
  const handleCloseTabsToRight = useCallback(
    (tabId: string) => {
      if (!activeWorktreeId) {
        return
      }
      const currentOrder = useAppStore.getState().tabBarOrderByWorktree[activeWorktreeId] ?? []
      const index = currentOrder.indexOf(tabId)
      if (index === -1) {
        return
      }
      closeTabBarTabs(currentOrder.slice(index + 1))
    },
    [activeWorktreeId, closeTabBarTabs]
  )
  const handleCloseTabsToLeft = useCallback(
    (tabId: string) => {
      if (!activeWorktreeId) {
        return
      }
      const currentOrder = useAppStore.getState().tabBarOrderByWorktree[activeWorktreeId] ?? []
      const index = currentOrder.indexOf(tabId)
      if (index === -1) {
        return
      }
      closeTabBarTabs(currentOrder.slice(0, index))
    },
    [activeWorktreeId, closeTabBarTabs]
  )
  const handleCloseAllFiles = useCallback(() => {
    if (!activeWorktreeId) {
      return
    }
    const state = useAppStore.getState()
    const filesInWorktree = state.openFiles.filter((file) => file.worktreeId === activeWorktreeId)
    const closableFiles = filesInWorktree.filter(
      (file) => !isPinnedEditorFileTab(state, activeWorktreeId, file.id)
    )
    if (closableFiles.length > 0) {
      queueEditorCloseRequests(closableFiles.map((file) => file.id))
    }
  }, [activeWorktreeId, queueEditorCloseRequests])

  return {
    closeTabBarTabs,
    handleCloseOthers,
    handleCloseTabsToRight,
    handleCloseTabsToLeft,
    handleCloseAllFiles
  }
}

export type TerminalBulkCloseController = TerminalCloseController &
  ReturnType<typeof useTerminalBulkCloseActions>
