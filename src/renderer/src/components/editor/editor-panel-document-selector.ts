import type { AppState } from '@/store'
import { getWorkingDocumentForFile } from '@renderer/store/slices/editor/working-document-state'
import type { OpenFile } from '@/store/slices/editor'

/**
 * Projects the canonical content for the document retained by each relevant tab.
 * The projection is intentionally tab-keyed because view state and panel routing
 * remain tab-local while document state is shared by every retained view.
 */
type EditorPanelDocumentState = Pick<
  AppState,
  'workingDocuments' | 'workingDocumentIdsByTab' | 'unifiedTabsByWorktree'
>
type EditorPanelDocumentSelector = (state: EditorPanelDocumentState) => Record<string, string>

const EMPTY_EDITOR_PANEL_DOCUMENT_CONTENT = Object.freeze({}) as Record<string, string>

export function createEditorPanelDocumentSelector(
  activeFile: OpenFile | null
): EditorPanelDocumentSelector {
  // Preview tabs refer to their source tab, while a conflict overview can render
  // a selected child tab. Keep this selection narrow so unrelated documents do
  // not wake the active panel on every keystroke.
  const tabIds = activeFile
    ? Array.from(
        new Set(
          [
            activeFile.id,
            activeFile.markdownPreviewSourceFileId,
            activeFile.conflictReview?.selectedFileId
          ].filter((tabId): tabId is string => Boolean(tabId))
        )
      )
    : []
  let previousDocuments: AppState['workingDocuments'] | null = null
  let previousMemberships: AppState['workingDocumentIdsByTab'] | null = null
  let previousUnifiedTabs: AppState['unifiedTabsByWorktree'] | null = null
  let previousSelection = EMPTY_EDITOR_PANEL_DOCUMENT_CONTENT

  return (state) => {
    if (
      previousDocuments === state.workingDocuments &&
      previousMemberships === state.workingDocumentIdsByTab &&
      previousUnifiedTabs === state.unifiedTabsByWorktree
    ) {
      return previousSelection
    }
    previousDocuments = state.workingDocuments
    previousMemberships = state.workingDocumentIdsByTab
    previousUnifiedTabs = state.unifiedTabsByWorktree

    const changed = tabIds.some((tabId) => {
      const content = getWorkingDocumentForFile(state, tabId)?.content
      return (
        content !== previousSelection[tabId] ||
        (content === undefined && Object.hasOwn(previousSelection, tabId))
      )
    })
    if (!changed) {
      return previousSelection
    }

    const nextSelection: Record<string, string> = {}
    for (const tabId of tabIds) {
      const content = getWorkingDocumentForFile(state, tabId)?.content
      if (content !== undefined) {
        nextSelection[tabId] = content
      }
    }
    previousSelection = nextSelection
    return previousSelection
  }
}
