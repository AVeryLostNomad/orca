import type { EditorGet, EditorSet } from '../types/editor-set-get'
import type { EditorSlice } from '../types/editor-slice'
import { getRecentlyClosedTabPosition, pushRecentlyClosedTabKind } from '../../recently-closed-tabs'
import { notifyHostOfMirroredEditorClose } from '@/runtime/close-mirrored-editor-tab'
import { markRuntimeEditorTabPublishClosed } from '@/runtime/runtime-editor-tab-publish'
import { type ClosedEditorTabSnapshot, MAX_RECENT_CLOSED_EDITOR_TABS } from '../types/open-file'
import { removeMarkdownVisibilityKeys } from '../tabs/workspace-editor-item'
import {
  deleteUntouchedUntitledFile,
  shouldDeleteScratchFileOnClose,
  shouldDeleteUntouchedUntitledFile
} from '../tabs/untitled-file-cleanup'
import { getWorkingDocumentForFile, getWorkingDocumentIdsForTab } from '../working-document-state'
import { unifiedTabsKeepWorktreeSelected } from './unified-tabs-keep-worktree-selected'
import { findAdjacentOpenFileId } from '../tabs/adjacent-open-file'
import { mayShareEditorBackingFile } from '../file-ids/editor-file-ids'
import { isSameOwnedDocument } from '../file-ids/same-owned-editor-document'
import { isEditorTabContentType } from '../tabs/editor-tab-content-type'
import { closeFileTabsThroughLayoutOwner } from '../tabs/editor-tab-close-through-layout-owner'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../../../../shared/layout-owner-switch'

export function createCloseFileAction(
  set: EditorSet,
  get: EditorGet
): Pick<EditorSlice, 'closeFile'> {
  return {
    closeFile: (fileId, opts) => {
      // Why: capture untitled+dirty state before set() mutates the store, so cleanup of throwaway untitled files can decide after removal.
      const preClose = get().openFiles.find((f) => f.id === fileId)
      // Why: stale same-owner records survive tab close; retain other owners and pending drafts.
      const fileIdsToClose = new Set(
        preClose
          ? get()
              .openFiles.filter(
                (file) =>
                  file.id === fileId ||
                  (preClose.mode === 'edit' &&
                    file.mode === 'edit' &&
                    preClose.readOnly !== true &&
                    file.readOnly !== true &&
                    isSameOwnedDocument(file, preClose) &&
                    !get().unifiedTabsByWorktree[file.worktreeId]?.some(
                      (tab) => tab.entityId === file.id && tab.isPinned
                    ) &&
                    !file.isDirty)
              )
              .map((file) => file.id)
          : [fileId]
      )
      const unifiedTabIdsToClose = Object.values(get().unifiedTabsByWorktree ?? {}).flatMap(
        (tabs) =>
          tabs
            .filter(
              (entry) =>
                fileIdsToClose.has(entry.entityId) && isEditorTabContentType(entry.contentType)
            )
            .map((entry) => entry.id)
      )
      const closedTabOrderIds = new Set([...fileIdsToClose, ...unifiedTabIdsToClose])
      const preCloseFiles = get().openFiles.filter((file) => fileIdsToClose.has(file.id))
      // A final dirty working document is handled by the close plan; release memberships after removal.
      const membershipTabIds = [...closedTabOrderIds]
      const hasDraft = membershipTabIds.some((tabId) =>
        getWorkingDocumentIdsForTab(get(), tabId).some(
          (documentId) => get().workingDocuments[documentId]?.isDirty === true
        )
      )
      const isScratchClose = shouldDeleteScratchFileOnClose(preClose)
      const shouldDeleteFromDisk =
        preClose !== undefined &&
        (isScratchClose ||
          shouldDeleteUntouchedUntitledFile(
            preClose,
            hasDraft,
            getWorkingDocumentForFile(get(), fileId)?.lastKnownDiskSignature
          )) &&
        !get().openFiles.some(
          (file) => !fileIdsToClose.has(file.id) && mayShareEditorBackingFile(file, preClose)
        )

      for (const file of preCloseFiles) {
        // A locally published tab can close before the host snapshot carries its id.
        markRuntimeEditorTabPublishClosed(get(), file)
        // Notify mirrored host closes or its next snapshot reopens the tab.
        notifyHostOfMirroredEditorClose(get(), file.worktreeId, file.id)
      }

      // Switch point: the tab's place is read before main's frame drops the tab.
      const closedPosition =
        ORCA_LAYOUT_OWNER_IS_MAIN && preClose
          ? getRecentlyClosedTabPosition(get(), preClose.worktreeId, fileId)
          : undefined
      const cleanUp = (): void => {
        set((s) => {
          // Switch point: the frame that dropped the tab may have dropped its record already.
          const closedFile =
            s.openFiles.find((f) => f.id === fileId) ??
            (ORCA_LAYOUT_OWNER_IS_MAIN ? preClose : undefined)
          const newFiles = s.openFiles.filter((f) => !fileIdsToClose.has(f.id))
          const newMarkdownViewMode = { ...s.markdownViewMode }
          const newMarkdownRichModeSizeOverride = { ...s.markdownRichModeSizeOverride }
          const newEditorViewMode = { ...s.editorViewMode }
          const newEditorCursorLine = { ...s.editorCursorLine }
          for (const id of fileIdsToClose) {
            delete newMarkdownViewMode[id]
            delete newMarkdownRichModeSizeOverride[id]
            delete newEditorViewMode[id]
            // Why: editorCursorLine is keyed by fileId and grows unbounded across a long session without cleanup on close.
            delete newEditorCursorLine[id]
          }
          const markdownVisibilityKeys = new Set(fileIdsToClose)
          for (const file of preCloseFiles) {
            if (file.markdownPreviewSourceFileId) {
              markdownVisibilityKeys.add(file.markdownPreviewSourceFileId)
            }
          }
          const visibilityKeysToRemove = [...markdownVisibilityKeys].filter(
            (key) =>
              !newFiles.some((file) => file.id === key || file.markdownPreviewSourceFileId === key)
          )
          const newMarkdownFrontmatterVisible =
            visibilityKeysToRemove.length > 0
              ? removeMarkdownVisibilityKeys(s.markdownFrontmatterVisible, visibilityKeysToRemove)
              : s.markdownFrontmatterVisible
          const newMarkdownTableOfContentsVisible =
            visibilityKeysToRemove.length > 0
              ? removeMarkdownVisibilityKeys(
                  s.markdownTableOfContentsVisible,
                  visibilityKeysToRemove
                )
              : s.markdownTableOfContentsVisible
          let newActiveId = s.activeFileId
          const newActiveFileIdByWorktree = { ...s.activeFileIdByWorktree }

          if (s.activeFileId && fileIdsToClose.has(s.activeFileId)) {
            const worktreeId = closedFile?.worktreeId ?? s.activeWorktreeId
            const worktreeFiles = worktreeId
              ? s.openFiles.filter((file) => file.worktreeId === worktreeId)
              : s.openFiles
            newActiveId = findAdjacentOpenFileId(worktreeFiles, fileIdsToClose, s.activeFileId)
          }

          const closedWorktreeId = closedFile?.worktreeId
          if (closedWorktreeId) {
            const worktreeFiles = s.openFiles.filter((file) => file.worktreeId === closedWorktreeId)
            const worktreeActiveFileId = s.activeFileIdByWorktree[closedWorktreeId]
            if (worktreeActiveFileId && fileIdsToClose.has(worktreeActiveFileId)) {
              newActiveFileIdByWorktree[closedWorktreeId] = findAdjacentOpenFileId(
                worktreeFiles,
                fileIdsToClose,
                worktreeActiveFileId
              )
            } else if (s.activeFileId && fileIdsToClose.has(s.activeFileId)) {
              newActiveFileIdByWorktree[closedWorktreeId] = newActiveId
            }
          }

          // Why: editors share a mixed tab strip with browser tabs; closing the last editor should reveal a browser tab before falling back to a terminal.
          const activeWorktreeId = s.activeWorktreeId
          const remainingForWorktree = activeWorktreeId
            ? newFiles.filter((f) => f.worktreeId === activeWorktreeId)
            : newFiles
          const browserTabsForWorktree = activeWorktreeId
            ? (s.browserTabsByWorktree[activeWorktreeId] ?? [])
            : []
          const terminalTabsForWorktree = activeWorktreeId
            ? (s.tabsByWorktree[activeWorktreeId] ?? [])
            : []
          const fallbackBrowserTabId =
            activeWorktreeId && browserTabsForWorktree.length > 0
              ? (s.activeBrowserTabIdByWorktree[activeWorktreeId] ??
                browserTabsForWorktree[0]?.id ??
                null)
              : s.activeBrowserTabId
          // Why: closing a background workspace's file must not change what the focused one shows.
          const closesBackgroundFile =
            activeWorktreeId !== null &&
            closedWorktreeId !== undefined &&
            closedWorktreeId !== activeWorktreeId
          const newActiveTabType =
            remainingForWorktree.length > 0 || closesBackgroundFile
              ? s.activeTabType
              : browserTabsForWorktree.length > 0
                ? 'browser'
                : 'terminal'
          const newActiveTabTypeByWorktree = { ...s.activeTabTypeByWorktree }
          if (activeWorktreeId && remainingForWorktree.length === 0 && !closesBackgroundFile) {
            newActiveTabTypeByWorktree[activeWorktreeId] =
              browserTabsForWorktree.length > 0 ? 'browser' : 'terminal'
          }
          // Structured chats have no legacy terminal row to keep their workspace selected.
          const hasRemainingUnifiedTabs =
            activeWorktreeId !== null &&
            unifiedTabsKeepWorktreeSelected(
              s.unifiedTabsByWorktree?.[activeWorktreeId],
              fileIdsToClose
            )
          const shouldDeactivateWorktree =
            activeWorktreeId !== null &&
            !closesBackgroundFile &&
            remainingForWorktree.length === 0 &&
            browserTabsForWorktree.length === 0 &&
            terminalTabsForWorktree.length === 0 &&
            !hasRemainingUnifiedTabs

          // Why: prune the closed id from tabBarOrderByWorktree so stale ids don't shift positions on the next reconcile.
          const worktreeId = closedFile?.worktreeId ?? activeWorktreeId
          const nextTabBarOrderByWorktree =
            worktreeId && s.tabBarOrderByWorktree
              ? {
                  ...s.tabBarOrderByWorktree,
                  [worktreeId]: (s.tabBarOrderByWorktree[worktreeId] ?? []).filter(
                    (entryId) => !closedTabOrderIds.has(entryId)
                  )
                }
              : s.tabBarOrderByWorktree

          let nextRecentlyClosed = s.recentlyClosedEditorTabsByWorktree
          let nextRecentlyClosedKinds = s.recentlyClosedTabKindsByWorktree
          const wtRecent = closedFile?.worktreeId
          // Exclude deleted empty placeholders, ephemeral previews and chat visuals from undo; they have no useful reopen target.
          if (
            closedFile &&
            wtRecent &&
            opts?.captureRecentlyClosed !== false &&
            !shouldDeleteFromDisk &&
            closedFile.mode !== 'markdown-preview'
          ) {
            const {
              id: _id,
              isDirty: _dirty,
              mirroredFromRuntimeSession: _mirrored,
              ...snap
            } = closedFile
            const stack = s.recentlyClosedEditorTabsByWorktree[wtRecent] ?? []
            const position = ORCA_LAYOUT_OWNER_IS_MAIN
              ? closedPosition
              : getRecentlyClosedTabPosition(s, wtRecent, fileId)
            nextRecentlyClosed = {
              ...s.recentlyClosedEditorTabsByWorktree,
              [wtRecent]: [
                {
                  ...(snap as ClosedEditorTabSnapshot),
                  reopenId: fileId,
                  ...(position ? { position } : {})
                },
                ...stack
              ].slice(0, MAX_RECENT_CLOSED_EDITOR_TABS)
            }
            nextRecentlyClosedKinds = pushRecentlyClosedTabKind(
              s.recentlyClosedTabKindsByWorktree,
              wtRecent,
              'editor'
            )
          }

          return {
            openFiles: newFiles,
            editorCursorLine: newEditorCursorLine,
            activeFileId: newActiveId,
            // Why: if the last editor closes with no browser/terminal surface left, return to the landing state like the terminal/browser close handlers do.
            activeWorktreeId: shouldDeactivateWorktree ? null : s.activeWorktreeId,
            activeBrowserTabId: shouldDeactivateWorktree
              ? null
              : activeWorktreeId && remainingForWorktree.length === 0
                ? fallbackBrowserTabId
                : s.activeBrowserTabId,
            activeTabType: newActiveTabType,
            activeFileIdByWorktree: newActiveFileIdByWorktree,
            activeTabTypeByWorktree: newActiveTabTypeByWorktree,
            markdownViewMode: newMarkdownViewMode,
            markdownRichModeSizeOverride: newMarkdownRichModeSizeOverride,
            editorViewMode: newEditorViewMode,
            markdownFrontmatterVisible: newMarkdownFrontmatterVisible,
            markdownTableOfContentsVisible: newMarkdownTableOfContentsVisible,
            tabBarOrderByWorktree: nextTabBarOrderByWorktree,
            pendingEditorReveal: null,
            pendingEditorFocusRequest:
              s.pendingEditorFocusRequest && fileIdsToClose.has(s.pendingEditorFocusRequest.fileId)
                ? null
                : s.pendingEditorFocusRequest,
            recentlyClosedEditorTabsByWorktree: nextRecentlyClosed,
            recentlyClosedTabKindsByWorktree: nextRecentlyClosedKinds
          }
        })
        for (const tabId of membershipTabIds) {
          get().releaseWorkingDocumentsForTab(tabId)
        }

        // Eagerly created empty untitled paths are bindable placeholders; delete them after close to avoid disk clutter.
        if (shouldDeleteFromDisk && preClose && typeof window !== 'undefined') {
          deleteUntouchedUntitledFile(get, preClose, { evenIfEdited: isScratchClose })
        }
      }

      // Switch point: the file's content goes once main's frame dropped its tabs; a refusal keeps both.
      if (ORCA_LAYOUT_OWNER_IS_MAIN && unifiedTabIdsToClose.length > 0) {
        closeFileTabsThroughLayoutOwner(
          get,
          unifiedTabIdsToClose,
          { worktreeId: preClose?.worktreeId ?? '', fileId },
          cleanUp
        )
        return
      }
      cleanUp()

      // Why: route editor/diff closes through the unified close path (MRU + visual-neighbor fallback) so they match terminal/browser tab-close behavior.
      for (const unifiedTabId of unifiedTabIdsToClose) {
        get().closeUnifiedTab(unifiedTabId)
      }
    }
  }
}
