import { useEffect, useRef } from 'react'
import type { FileTreeDirectoryHandle } from '@pierre/trees'
import { useAppStore } from '@/store'
import { getRelativePathInsideRoot } from '@/lib/path'
import {
  getRelativeAncestorDirs,
  normalizeTreeRelativePath
} from './file-explorer-tree-relative-paths'
import type { FileTreeModelLike } from './use-file-explorer-tree-model'
import { useFileTreeVersion } from './use-file-tree-version'

function expandAncestors(model: FileTreeModelLike, relativePath: string): void {
  for (const ancestor of getRelativeAncestorDirs(relativePath)) {
    const handle = model.getItem(ancestor)
    if (handle?.isDirectory()) {
      ;(handle as FileTreeDirectoryHandle).expand()
    }
  }
}

function selectOnly(model: FileTreeModelLike, relativePath: string): void {
  const target = normalizeTreeRelativePath(relativePath)
  for (const selected of model.getSelectedPaths()) {
    if (normalizeTreeRelativePath(selected) !== target) {
      model.getItem(selected)?.deselect()
    }
  }
  model.getItem(target)?.select()
}

/** Reveal target if it exists in the tree; returns whether it was revealed. */
function revealPath(
  model: FileTreeModelLike,
  relativePath: string,
  options: { focus: boolean; select: boolean }
): boolean {
  if (!model.getItem(relativePath)) {
    return false
  }
  expandAncestors(model, relativePath)
  if (options.select) {
    selectOnly(model, relativePath)
  }
  model.scrollToPath(relativePath, { focus: options.focus, offset: 'nearest' })
  return true
}

type UseFileTreeRevealParams = {
  model: FileTreeModelLike | null
  activeWorktreeId: string | null
  worktreePath: string | null
  activeFileId: string | null
  enabled: boolean
}

/**
 * Auto-reveal (active editor file follows into the tree, VS Code style) plus
 * explicit "Reveal in Explorer" requests from the store.
 */
export function useFileTreeReveal({
  model,
  activeWorktreeId,
  worktreePath,
  activeFileId,
  enabled
}: UseFileTreeRevealParams): void {
  const prevActiveFileIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (activeFileId === prevActiveFileIdRef.current) {
      return
    }
    prevActiveFileIdRef.current = activeFileId
    if (!enabled || !model || !activeFileId || !activeWorktreeId || !worktreePath) {
      return
    }
    const state = useAppStore.getState()
    // Why: a pending manual reveal (Source Control → Reveal in Explorer) wins.
    if (state.pendingExplorerReveal) {
      return
    }
    const activeFile = state.openFiles.find((f) => f.id === activeFileId)
    if (
      !activeFile ||
      activeFile.worktreeId !== activeWorktreeId ||
      (activeFile.mode !== 'edit' && activeFile.mode !== 'markdown-preview')
    ) {
      return
    }
    const relative = getRelativePathInsideRoot(activeFile.filePath, worktreePath)
    if (!relative) {
      return
    }
    // Why: auto-reveal must not steal keyboard focus from the editor.
    if (model.getSelectedPaths().length <= 1) {
      revealPath(model, normalizeTreeRelativePath(relative), { focus: false, select: true })
    } else {
      revealPath(model, normalizeTreeRelativePath(relative), { focus: false, select: false })
    }
  }, [activeFileId, activeWorktreeId, enabled, model, worktreePath])

  const pendingExplorerReveal = useAppStore((s) => s.pendingExplorerReveal)
  const clearPendingExplorerReveal = useAppStore((s) => s.clearPendingExplorerReveal)
  const treeVersion = useFileTreeVersion(model)
  useEffect(() => {
    if (!pendingExplorerReveal || !model || !activeWorktreeId || !worktreePath) {
      return
    }
    if (pendingExplorerReveal.worktreeId !== activeWorktreeId) {
      return
    }
    const relative = getRelativePathInsideRoot(pendingExplorerReveal.filePath, worktreePath)
    if (!relative) {
      clearPendingExplorerReveal()
      return
    }
    if (revealPath(model, normalizeTreeRelativePath(relative), { focus: true, select: true })) {
      clearPendingExplorerReveal()
    }
    // Why: if the file list has not loaded the path yet, keep the request
    // pending; treeVersion re-runs this once the model resets with fresh paths.
  }, [
    activeWorktreeId,
    clearPendingExplorerReveal,
    model,
    pendingExplorerReveal,
    treeVersion,
    worktreePath
  ])
}
