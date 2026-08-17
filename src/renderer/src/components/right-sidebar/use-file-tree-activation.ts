import { useCallback } from 'react'
import type React from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { detectLanguage } from '@/lib/language-detect'
import { basename, joinPath } from '@/lib/path'
import type { FileExplorerOperationOwner } from './file-explorer-types'
import {
  getFileExplorerOwnerUnresolvedMessage,
  requireMatchingFileExplorerOperationRoute
} from './file-explorer-operation-owner'
import { normalizeTreeRelativePath } from './file-explorer-tree-relative-paths'
import type { FileTreeModelLike } from './use-file-explorer-tree-model'

export type FileTreeRowTarget = { relativePath: string; isFolder: boolean }

/** Resolve the tree row from a composed event escaping the shadow root. */
export function resolveFileTreeRowFromEvent(event: Event): FileTreeRowTarget | null {
  for (const element of event.composedPath()) {
    if (!(element instanceof HTMLElement)) {
      continue
    }
    // Why: clicks on the row's context-menu affordances or the inline rename
    // input must not count as file activation.
    if (
      element instanceof HTMLInputElement ||
      element.dataset.type === 'context-menu-trigger' ||
      element.dataset.type === 'context-menu-anchor'
    ) {
      return null
    }
    if (element.dataset.itemPath) {
      return {
        relativePath: element.dataset.itemPath,
        isFolder: element.dataset.itemType === 'folder'
      }
    }
  }
  return null
}

type UseFileTreeActivationParams = {
  model: FileTreeModelLike | null
  activeWorktreeId: string | null
  worktreePath: string | null
  operationOwner: FileExplorerOperationOwner | undefined
}

type UseFileTreeActivationResult = {
  openFilePreview: (relativePath: string) => void
  handleClick: (event: React.MouseEvent<HTMLDivElement>) => void
  handleDoubleClick: (event: React.MouseEvent<HTMLDivElement>) => void
  handleKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
}

/**
 * File-open shim over the tree: @pierre/trees has no activation callback, so
 * wrapper-level listeners resolve rows from composed events. Directory
 * expand/collapse stays native to the library.
 */
export function useFileTreeActivation({
  model,
  activeWorktreeId,
  worktreePath,
  operationOwner
}: UseFileTreeActivationParams): UseFileTreeActivationResult {
  const openFile = useAppStore((s) => s.openFile)
  const makePreviewFilePermanent = useAppStore((s) => s.makePreviewFilePermanent)

  // Why: with an embedded VS Code tab open for this worktree, file activation
  // hands off to that editor; Monaco stays the fallback if the handoff fails.
  const openInCodeServerTab = useCallback(
    async (absolutePath: string): Promise<boolean> => {
      const state = useAppStore.getState()
      if (!activeWorktreeId || state.codeServerStatus !== 'ready') {
        return false
      }
      const tab = (state.codeServerTabsByWorktree[activeWorktreeId] ?? [])[0]
      // Why: guard the preload surface — a stale preload (dev HMR) must fall
      // back to Monaco instead of throwing away the click.
      if (!tab || typeof window.api.codeServer.openFile !== 'function') {
        return false
      }
      try {
        const opened = await window.api.codeServer.openFile({ path: absolutePath })
        if (opened) {
          state.setActiveCodeServerTab(tab.id)
        }
        return opened
      } catch {
        return false
      }
    },
    [activeWorktreeId]
  )

  const openFilePreview = useCallback(
    (relativePath: string) => {
      if (!activeWorktreeId || !worktreePath) {
        return
      }
      let runtimeEnvironmentId: string | null
      try {
        const route = requireMatchingFileExplorerOperationRoute(activeWorktreeId, operationOwner)
        runtimeEnvironmentId = route.settings.activeRuntimeEnvironmentId?.trim() || null
      } catch {
        toast.error(getFileExplorerOwnerUnresolvedMessage())
        return
      }
      const relative = normalizeTreeRelativePath(relativePath)
      const absolutePath = joinPath(worktreePath, relative)
      const language = detectLanguage(basename(relative))
      const openInMonaco = (): void => {
        openFile(
          {
            filePath: absolutePath,
            relativePath: relative,
            worktreeId: activeWorktreeId,
            runtimeEnvironmentId: runtimeEnvironmentId ?? undefined,
            language,
            mode: 'edit'
          },
          {
            preview: true,
            // Why: activating an Explorer file is a focus handoff even if the
            // rich editor finishes mounting after the row receives browser focus.
            focusEditor: true,
            // Why: explicit explorer opens must not inherit the active runtime;
            // "no runtime owner" is encoded via fallback suppression.
            suppressActiveRuntimeFallback: runtimeEnvironmentId === null
          }
        )
      }
      // Why: markdown stays in Orca's own viewer even when a VS Code tab is open.
      if (language === 'markdown') {
        openInMonaco()
        return
      }
      void openInCodeServerTab(absolutePath).then((opened) => {
        if (!opened) {
          openInMonaco()
        }
      })
    },
    [activeWorktreeId, openFile, openInCodeServerTab, operationOwner, worktreePath]
  )

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // Why: modifier clicks are selection gestures the library already owns.
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        return
      }
      const row = resolveFileTreeRowFromEvent(event.nativeEvent)
      if (row && !row.isFolder) {
        openFilePreview(row.relativePath)
      }
    },
    [openFilePreview]
  )

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const row = resolveFileTreeRowFromEvent(event.nativeEvent)
      if (row && !row.isFolder && worktreePath) {
        makePreviewFilePermanent(
          joinPath(worktreePath, normalizeTreeRelativePath(row.relativePath))
        )
      }
    },
    [makePreviewFilePermanent, worktreePath]
  )

  // Why: Space activates the focused row; Enter is the rename key (old
  // explorer parity — see use-file-tree-keyboard-commands).
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== ' ' || event.shiftKey || event.metaKey || event.ctrlKey || !model) {
        return
      }
      // Why: typing spaces into the inline rename input must not open files.
      const composedTarget = event.nativeEvent.composedPath()[0]
      if (composedTarget instanceof HTMLInputElement) {
        return
      }
      const focusedPath = model.getFocusedPath()
      if (!focusedPath) {
        return
      }
      const item = model.getItem(focusedPath)
      if (item && !item.isDirectory()) {
        event.preventDefault()
        openFilePreview(focusedPath)
      }
    },
    [model, openFilePreview]
  )

  return { openFilePreview, handleClick, handleDoubleClick, handleKeyDown }
}
