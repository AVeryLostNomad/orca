import { useCallback, useMemo } from 'react'
import type { FileTreeDirectoryHandle } from '@pierre/trees'
import { useAppStore } from '@/store'
import { basename, getRelativePathInsideRoot, joinPath } from '@/lib/path'
import { createNewTerminalTab } from '@/components/terminal/terminal-tab-create'
import type { Repo } from '../../../../shared/repo-types'
import type { OpenFile } from '@/store/slices/editor'
import {
  buildAddProjectFromFolderModalData,
  canShowAddAsProjectAction
} from './file-explorer-add-project-action'
import { formatFileExplorerPathsForClipboard } from './file-explorer-selection'
import { isPathEqualOrDescendant } from './file-explorer-paths'
import { folderRelativePathToIncludeGlob } from './file-search-include-pattern'
import { normalizeTreeRelativePath } from './file-explorer-tree-relative-paths'
import type { FileExplorerOperationOwner, TreeNode } from './file-explorer-types'
import { useFileDeletion } from './useFileDeletion'
import { useFileDuplicate } from './useFileDuplicate'
import type { FileTreeModelLike } from './use-file-explorer-tree-model'

type UseFileTreeNodeCommandsParams = {
  model: FileTreeModelLike | null
  activeWorktreeId: string | null
  worktreePath: string | null
  activeRepo: Repo | null
  operationOwner: FileExplorerOperationOwner | undefined
  selectedPaths: Set<string>
  applySelectedPaths: (absolutePaths: Set<string>) => void
  openFiles: OpenFile[]
  refreshFileList: () => void
}

export type FileTreeNodeCommands = {
  buildNode: (relativePath: string, isDirectory: boolean) => TreeNode | null
  isNodeExpanded: (node: TreeNode) => boolean
  deleteShortcutLabel: string
  copyPathsForNode: (node: TreeNode, pathKind: 'absolute' | 'relative') => void
  handleStartRename: (node: TreeNode) => void
  handleDuplicate: (node: TreeNode) => void
  handleAddFolderAsProject: (node: TreeNode) => void
  canAddAsProject: (node: TreeNode) => boolean
  handleOpenInTerminal: (node: TreeNode) => void
  handleContextMenuDelete: (node: TreeNode) => void
  handleCollapseFolderSubtree: (node: TreeNode) => void
  handleFindInFolder: (node: TreeNode) => void
}

/** Context-menu command layer for the @pierre/trees pane, operating on tree paths. */
export function useFileTreeNodeCommands({
  model,
  activeWorktreeId,
  worktreePath,
  activeRepo,
  operationOwner,
  selectedPaths,
  applySelectedPaths,
  openFiles,
  refreshFileList
}: UseFileTreeNodeCommandsParams): FileTreeNodeCommands {
  const closeFile = useAppStore((s) => s.closeFile)
  const collapseDirSubtree = useAppStore((s) => s.collapseDirSubtree)
  const openModal = useAppStore((s) => s.openModal)
  const showRightSidebarSearch = useAppStore((s) => s.showRightSidebarSearch)
  const isWindows = useMemo(() => navigator.userAgent.includes('Windows'), [])

  const buildNode = useCallback(
    (relativePath: string, isDirectory: boolean): TreeNode | null => {
      if (!worktreePath) {
        return null
      }
      const relative = normalizeTreeRelativePath(relativePath)
      if (!relative) {
        return null
      }
      return {
        name: basename(relative),
        path: joinPath(worktreePath, relative),
        relativePath: relative,
        isDirectory,
        depth: relative.split('/').length - 1,
        operationOwner
      }
    },
    [operationOwner, worktreePath]
  )

  const isNodeExpanded = useCallback(
    (node: TreeNode): boolean => {
      const handle = model?.getItem(node.relativePath)
      return handle?.isDirectory() ? (handle as FileTreeDirectoryHandle).isExpanded() : false
    },
    [model]
  )

  const buildSelectedNodes = useCallback((): TreeNode[] => {
    if (!model || !worktreePath) {
      return []
    }
    const nodes: TreeNode[] = []
    for (const absolutePath of selectedPaths) {
      const relative = getRelativePathInsideRoot(absolutePath, worktreePath)
      if (!relative) {
        continue
      }
      const item = model.getItem(normalizeTreeRelativePath(relative))
      const node = item ? buildNode(relative, item.isDirectory()) : null
      if (node) {
        nodes.push(node)
      }
    }
    return nodes
  }, [buildNode, model, selectedPaths, worktreePath])

  // Why: refresh granularity is the whole flat list; the watcher applies
  // fine-grained mutations, so this only backs undo/redo and failure resyncs.
  const refreshDir = useCallback(async () => refreshFileList(), [refreshFileList])

  const deletion = useFileDeletion({
    activeWorktreeId,
    openFiles,
    closeFile,
    refreshDir,
    setSelectedPaths: applySelectedPaths,
    isWindows
  })

  const copyPathsForNode = useCallback(
    (node: TreeNode, pathKind: 'absolute' | 'relative') => {
      const selectedNodes = selectedPaths.has(node.path) ? buildSelectedNodes() : []
      const actionNodes = selectedNodes.length > 0 ? selectedNodes : [node]
      void window.api.ui.writeClipboardText(
        formatFileExplorerPathsForClipboard(actionNodes, pathKind)
      )
    },
    [buildSelectedNodes, selectedPaths]
  )

  const handleStartRename = useCallback(
    (node: TreeNode) => {
      model?.startRenaming(node.relativePath)
    },
    [model]
  )

  const handleDuplicate = useFileDuplicate({ activeWorktreeId, worktreePath, refreshDir })

  const handleContextMenuDelete = useCallback(
    (node: TreeNode) => {
      const selectedNodes = buildSelectedNodes()
      if (selectedPaths.has(node.path) && selectedNodes.length > 1) {
        deletion.requestDeleteAll(selectedNodes)
      } else {
        deletion.requestDelete(node)
      }
    },
    [buildSelectedNodes, deletion, selectedPaths]
  )

  const handleCollapseFolderSubtree = useCallback(
    (node: TreeNode) => {
      if (!model || !activeWorktreeId || !worktreePath || !node.isDirectory) {
        return
      }
      const expanded = useAppStore.getState().expandedDirs[activeWorktreeId] ?? new Set<string>()
      for (const absoluteDir of [...expanded, node.path]) {
        if (!isPathEqualOrDescendant(absoluteDir, node.path)) {
          continue
        }
        const relative = getRelativePathInsideRoot(absoluteDir, worktreePath)
        const handle = relative ? model.getItem(normalizeTreeRelativePath(relative)) : null
        if (handle?.isDirectory()) {
          ;(handle as FileTreeDirectoryHandle).collapse()
        }
      }
      collapseDirSubtree(activeWorktreeId, node.path)
    },
    [activeWorktreeId, collapseDirSubtree, model, worktreePath]
  )

  const handleFindInFolder = useCallback(
    (node: TreeNode) => {
      if (!activeWorktreeId || !node.isDirectory) {
        return
      }
      showRightSidebarSearch({
        includePattern: folderRelativePathToIncludeGlob(node.relativePath)
      })
    },
    [activeWorktreeId, showRightSidebarSearch]
  )

  const canAddAsProject = useCallback(
    (node: TreeNode) => canShowAddAsProjectAction(node, activeRepo),
    [activeRepo]
  )

  const handleAddFolderAsProject = useCallback(
    (node: TreeNode) => {
      if (!activeRepo || !canShowAddAsProjectAction(node, activeRepo)) {
        return
      }
      openModal(
        'confirm-add-project-from-folder',
        buildAddProjectFromFolderModalData(node, activeRepo)
      )
    },
    [activeRepo, openModal]
  )

  const handleOpenInTerminal = useCallback(
    (node: TreeNode) => {
      if (!activeWorktreeId || !node.isDirectory) {
        return
      }
      createNewTerminalTab(activeWorktreeId, undefined, { startupCwd: node.path })
    },
    [activeWorktreeId]
  )

  return {
    buildNode,
    isNodeExpanded,
    deleteShortcutLabel: deletion.deleteShortcutLabel,
    copyPathsForNode,
    handleStartRename,
    handleDuplicate,
    handleAddFolderAsProject,
    canAddAsProject,
    handleOpenInTerminal,
    handleContextMenuDelete,
    handleCollapseFolderSubtree,
    handleFindInFolder
  }
}
