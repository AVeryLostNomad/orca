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
  /** Lists folders that were never expanded so a deep path gains a row. */
  loadDirs: (relativeDirs: readonly string[]) => Promise<void>
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
  enabled,
  loadDirs
}: UseFileTreeRevealParams): void {
  const prevActiveFileIdRef = useRef<string | null>(null)
  const loadDirsRef = useRef(loadDirs)
  loadDirsRef.current = loadDirs
  const pendingRevealLoadRef = useRef<object | null>(null)

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
    const target = normalizeTreeRelativePath(relative)
    // Why: auto-reveal must not steal keyboard focus from the editor.
    const reveal = (): boolean =>
      revealPath(model, target, { focus: false, select: model.getSelectedPaths().length <= 1 })
    if (!reveal()) {
      void loadDirsRef.current(getRelativeAncestorDirs(target)).then(() => {
        if (prevActiveFileIdRef.current === activeFileId) {
          reveal()
        }
      })
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
    const target = normalizeTreeRelativePath(relative)
    if (revealPath(model, target, { focus: true, select: true })) {
      clearPendingExplorerReveal()
      return
    }
    // Why: list the path's folders once per request; treeVersion re-runs this
    // when they land, and the request stays pending if the path never appears.
    if (pendingRevealLoadRef.current !== pendingExplorerReveal) {
      pendingRevealLoadRef.current = pendingExplorerReveal
      void loadDirsRef.current(getRelativeAncestorDirs(target))
    }
  }, [
    activeWorktreeId,
    clearPendingExplorerReveal,
    model,
    pendingExplorerReveal,
    treeVersion,
    worktreePath
  ])
}
