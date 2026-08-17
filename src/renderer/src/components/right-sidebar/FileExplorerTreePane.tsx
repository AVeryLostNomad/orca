import React, { useCallback, useEffect, useMemo } from 'react'
import { FileTree as FileTreeView } from '@pierre/trees/react'
import type {
  FileTree,
  ContextMenuItem as TreeContextMenuItem,
  ContextMenuOpenContext as TreeContextMenuOpenContext
} from '@pierre/trees'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { useWorkspaceFileBrowserActionPredicate } from '@/lib/file-preview'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { translate } from '@/i18n/i18n'
import type { RuntimeFileListState } from '@/components/quick-open-file-list'
import type { OpenFile } from '@/store/slices/editor'
import type { Repo } from '../../../../shared/repo-types'
import type { RightSidebarExplorerView } from '../../../../shared/ui-chrome-types'
import { FILE_EXPLORER_TREE_HOST_STYLE } from './file-explorer-tree-theme'
import { FileExplorerBackgroundMenu } from './FileExplorerBackgroundMenu'
import { FileExplorerTreeRowMenu } from './FileExplorerTreeRowMenu'
import { FileExplorerTreeStatus } from './FileExplorerTreeStatus'
import { useFileTreeActivation } from './use-file-tree-activation'
import { useFileExplorerBackgroundMenu } from './use-file-explorer-background-menu'
import { useFileTreeExpansionSync } from './use-file-tree-expansion-sync'
import { useFileTreeKeyboardCommands } from './use-file-tree-keyboard-commands'
import { useFileTreeNodeCommands } from './use-file-tree-node-commands'
import { useFileTreeReveal } from './use-file-tree-reveal'
import { useFileTreeVersion } from './use-file-tree-version'

const NAME_FILTER_SEARCH_DEBOUNCE_MS = 150

type FileExplorerTreePaneProps = {
  model: FileTree | null
  fileList: RuntimeFileListState
  refreshFileList: () => void
  activeRepo: Repo | null
  activeWorktreeId: string | null
  worktreePath: string | null
  visibleFilesWorktreePath: string | null
  explorerView: RightSidebarExplorerView
  isFilesViewActive: boolean
  activeFileId: string | null
  openFiles: OpenFile[]
  nameFilterQuery: string
  hasNameFilter: boolean
  selectedPaths: Set<string>
  applySelectedPaths: (absolutePaths: Set<string>) => void
  startNew: (kind: 'file' | 'folder', parentAbsoluteDir: string) => void
  isCreatePending: boolean
  isRenameActive: () => boolean
  nativeDropDir: string | null
  isNativeDragOver: boolean
  onNativeDragOver: (event: React.DragEvent<HTMLDivElement>) => void
  onNativeDragLeave: (event: React.DragEvent<HTMLDivElement>) => void
  onRowDragStartCapture: (event: React.DragEvent<HTMLDivElement>) => void
  onRowDragEndCapture: (event: React.DragEvent<HTMLDivElement>) => void
}

/** Explorer files pane rendered by @pierre/trees. */
export function FileExplorerTreePane({
  model,
  fileList,
  refreshFileList,
  activeRepo,
  activeWorktreeId,
  worktreePath,
  visibleFilesWorktreePath,
  explorerView,
  isFilesViewActive,
  activeFileId,
  openFiles,
  nameFilterQuery,
  hasNameFilter,
  selectedPaths,
  applySelectedPaths,
  startNew,
  isCreatePending,
  isRenameActive,
  nativeDropDir,
  isNativeDragOver,
  onNativeDragOver,
  onNativeDragLeave,
  onRowDragStartCapture,
  onRowDragEndCapture
}: FileExplorerTreePaneProps): React.JSX.Element {
  const activation = useFileTreeActivation({
    model,
    activeWorktreeId,
    worktreePath,
    operationOwner: fileList.operationOwner
  })
  useFileTreeExpansionSync({ model, activeWorktreeId, worktreePath, suspended: hasNameFilter })
  useFileTreeReveal({
    model,
    activeWorktreeId,
    worktreePath,
    activeFileId,
    enabled: isFilesViewActive
  })
  const commands = useFileTreeNodeCommands({
    model,
    activeWorktreeId,
    worktreePath,
    activeRepo,
    operationOwner: fileList.operationOwner,
    selectedPaths,
    applySelectedPaths,
    openFiles,
    refreshFileList
  })
  const handleCommandKeyDown = useFileTreeKeyboardCommands({
    model,
    commands,
    isRenameActive
  })
  const backgroundMenu = useFileExplorerBackgroundMenu({
    worktreePath,
    createPending: isCreatePending,
    startNew
  })

  // Why: our own filter input drives the library's search session.
  useEffect(() => {
    if (!model) {
      return
    }
    const value = hasNameFilter ? nameFilterQuery.trim() : ''
    const timer = window.setTimeout(
      () => model.setSearch(value.length > 0 ? value : null),
      NAME_FILTER_SEARCH_DEBOUNCE_MS
    )
    return () => window.clearTimeout(timer)
  }, [hasNameFilter, model, nameFilterQuery])

  // Why: the version bump re-renders this pane so visibleCount stays current.
  useFileTreeVersion(model)
  const visibleCount = model?.getVisibleCount() ?? 0

  const canOpenWorkspaceFileBrowserForPath =
    useWorkspaceFileBrowserActionPredicate(activeWorktreeId)
  const connectionId = activeRepo?.connectionId ?? null
  const supportsFolderDownload = useAppStore((s) =>
    connectionId ? s.sshConnectionStates.get(connectionId)?.supportsFolderDownload === true : false
  )
  const activeRuntimeEnvironmentId = useAppStore((s) =>
    getRuntimeEnvironmentIdForWorktree(s, activeWorktreeId)
  )
  const runtimeDownloadContext = useMemo(
    () =>
      activeRuntimeEnvironmentId && activeWorktreeId && worktreePath
        ? {
            settings: { activeRuntimeEnvironmentId },
            worktreeId: activeWorktreeId,
            worktreePath,
            connectionId: connectionId ?? undefined
          }
        : null,
    [activeRuntimeEnvironmentId, activeWorktreeId, connectionId, worktreePath]
  )

  const renderContextMenu = useCallback(
    (item: TreeContextMenuItem, context: TreeContextMenuOpenContext) => (
      <FileExplorerTreeRowMenu
        item={item}
        context={context}
        commands={commands}
        selectionSize={selectedPaths.size}
        connectionId={connectionId}
        runtimeDownloadContext={runtimeDownloadContext}
        supportsFolderDownload={supportsFolderDownload}
        canOpenInOrcaBrowser={canOpenWorkspaceFileBrowserForPath}
        openFilePreview={activation.openFilePreview}
        onStartNew={startNew}
      />
    ),
    [
      activation.openFilePreview,
      canOpenWorkspaceFileBrowserForPath,
      commands,
      connectionId,
      runtimeDownloadContext,
      selectedPaths.size,
      startNew,
      supportsFolderDownload
    ]
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      handleCommandKeyDown(event)
      if (!event.defaultPrevented) {
        activation.handleKeyDown(event)
      }
    },
    [activation, handleCommandKeyDown]
  )

  const isEmpty = visibleCount === 0
  const isLoading = isEmpty && fileList.loading && fileList.files.length === 0
  const treeError = isEmpty && !isLoading ? fileList.loadError : null
  const emptyMessage = hasNameFilter
    ? translate(
        'auto.components.right.sidebar.FileExplorerTreePane.24ff3db033',
        'No files match this filter'
      )
    : undefined

  return (
    <div
      className={cn(
        'absolute inset-0 flex min-h-0 flex-col overflow-hidden',
        explorerView !== 'files' && 'pointer-events-none invisible',
        isNativeDragOver && explorerView === 'files' && !nativeDropDir && 'bg-border'
      )}
      data-native-file-drop-target={isFilesViewActive ? 'file-explorer' : undefined}
      data-native-file-drop-dir={nativeDropDir ?? visibleFilesWorktreePath ?? undefined}
      onClick={activation.handleClick}
      onDoubleClick={(event) => {
        activation.handleDoubleClick(event)
        backgroundMenu.handleBackgroundDoubleClick(event)
      }}
      onKeyDown={handleKeyDown}
      onContextMenuCapture={backgroundMenu.handleBackgroundContextMenuCapture}
      onDragOver={onNativeDragOver}
      onDragLeave={onNativeDragLeave}
      onDragStartCapture={onRowDragStartCapture}
      onDragEndCapture={onRowDragEndCapture}
    >
      {(isLoading || treeError || isEmpty) && (
        <div className="absolute inset-0 z-10">
          <FileExplorerTreeStatus
            isLoading={isLoading}
            error={treeError}
            isEmpty={isEmpty && !isLoading && !treeError}
            emptyMessage={emptyMessage}
          />
        </div>
      )}
      {model && (
        <FileTreeView
          model={model}
          renderContextMenu={renderContextMenu}
          className="min-h-0 flex-1 py-1"
          style={FILE_EXPLORER_TREE_HOST_STYLE}
        />
      )}
      {worktreePath && (
        <FileExplorerBackgroundMenu
          open={backgroundMenu.bgMenuOpen}
          onOpenChange={backgroundMenu.setBgMenuOpen}
          point={backgroundMenu.bgMenuPoint}
          worktreePath={worktreePath}
          onStartNew={startNew}
        />
      )}
    </div>
  )
}
