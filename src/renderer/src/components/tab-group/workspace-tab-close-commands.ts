import type { Tab } from '../../../../shared/tab-types'
import { useAppStore } from '../../store'
import { getEditorClosePlan } from '@/store/slices/editor/working-document-state'
import { requestEditorTabClose } from '../editor/editor-autosave'
import { closeTerminalTab } from '../terminal/terminal-tab-actions'
import { closeWorkspaceBrowserTab } from '@/lib/workspace-browser-tab-close'
import { isEditorTabContentType } from '@/store/slices/editor/tabs/editor-tab-content-type'

export function createWorkspaceTabCloseCommands({
  worktreeId,
  groupTabs
}: {
  worktreeId: string
  groupTabs: Tab[]
}) {
  const { closeUnifiedTab, closeFile, closeCodeServerTab, closeDataStudioTab } =
    useAppStore.getState()

  const closeEditorIfUnreferenced = (
    entityId: string,
    closingTabId: string,
    whenEmptied: (() => void) | null
  ) => {
    // Prompt only when this tab is the last view of a dirty document, even if another tab shows the file.
    if (getEditorClosePlan(useAppStore.getState(), [closingTabId]).dirtyDocumentIds.length > 0) {
      // Why: route through Terminal.tsx so the unsaved-confirmation save/discard queue stays centralized across all close paths.
      requestEditorTabClose(closingTabId, whenEmptied ? { onClosed: whenEmptied } : undefined)
      return false
    }
    const otherReference = (useAppStore.getState().unifiedTabsByWorktree[worktreeId] ?? []).some(
      (item) =>
        item.id !== closingTabId &&
        item.entityId === entityId &&
        isEditorTabContentType(item.contentType)
    )
    if (!otherReference) {
      closeFile(entityId)
    }
    return true
  }

  /** `whenEmptied` is captured by the caller when the close is requested, before any prompt. */
  const closeItem = (
    itemId: string,
    opts?: { whenEmptied?: () => void; skipRunningProcessConfirm?: boolean }
  ) => {
    const item = groupTabs.find((candidate) => candidate.id === itemId)
    // Floating workspace notes is a permanent chip.
    if (!item || item.contentType === 'workspace-notes') {
      return
    }
    const whenEmptied = opts?.whenEmptied ?? null
    if (item.contentType === 'agent-session') {
      closeUnifiedTab(item.id)
      whenEmptied?.()
      return
    }
    if (item.contentType === 'terminal') {
      // Run the empty check only after deferred pin/process confirmations actually close the tab.
      closeTerminalTab(item.entityId, {
        ...(opts?.skipRunningProcessConfirm ? { skipRunningProcessConfirm: true } : {}),
        ...(whenEmptied ? { onClosed: whenEmptied } : {})
      })
      return
    }
    if (item.contentType === 'browser') {
      const plan = closeWorkspaceBrowserTab(worktreeId, item.entityId, item.id)
      // Unwinding an unfinished create must preserve selection rather than count as emptying the workspace.
      if (!plan.closesLocally || plan.localCloseReason === 'cleanup') {
        return
      }
    } else if (item.contentType === 'simulator') {
      closeUnifiedTab(item.id)
    } else if (item.contentType === 'vscode') {
      // Why: closeCodeServerTab removes the matching unified tab itself; closeUnifiedTab would double-close.
      closeCodeServerTab(item.entityId)
    } else if (item.contentType === 'datastudio') {
      closeDataStudioTab(item.entityId)
    } else {
      const canCloseTab = closeEditorIfUnreferenced(item.entityId, item.id, whenEmptied)
      if (!canCloseTab) {
        return
      }
      closeUnifiedTab(item.id)
    }
    whenEmptied?.()
  }

  return { closeItem }
}
