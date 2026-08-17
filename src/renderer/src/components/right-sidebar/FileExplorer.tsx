import React, { useCallback, useMemo, useRef } from 'react'
import type {
  FileTreeDirectoryHandle,
  FileTreeDropResult,
  FileTreeRenameEvent,
  FileTreeRenamingItem
} from '@pierre/trees'
import { useAppStore } from '@/store'
import { useActiveWorktree, useRepoById } from '@/store/selectors'
import { basename, getRelativePathInsideRoot } from '@/lib/path'
import { cn } from '@/lib/utils'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import { getVisibleFileExplorerWorktreePath } from './file-explorer-reset'
import { FileExplorerNameFilter } from './FileExplorerNameFilter'
import { FileExplorerQueryStrip } from './FileExplorerQueryStrip'
import { FileExplorerToolbar } from './FileExplorerToolbar'
import { FileExplorerTreePane } from './FileExplorerTreePane'
import { SearchFilters } from './SearchFilters'
import { SearchQueryRow } from './SearchQueryRow'
import { SearchResultsPane } from './SearchResultsPane'
import { useFileSearchPanel } from './useFileSearchPanel'
import { useFileExplorerManualRefresh } from './useFileExplorerManualRefresh'
import { useFileExplorerNameFilter } from './use-file-explorer-name-filter'
import { useFileExplorerTreeModel } from './use-file-explorer-tree-model'
import { isFileTreeRenameInputActive, useFileTreeCreate } from './use-file-tree-create'
import { useFileTreeDragOut } from './use-file-tree-drag-out'
import { useFileTreeDrop } from './use-file-tree-drop'
import { useFileTreeNativeImport } from './use-file-tree-native-import'
import { useFileTreeRename } from './use-file-tree-rename'
import { useFileTreeSelectionBridge } from './use-file-tree-selection-bridge'
import { useFileTreeWatch } from './use-file-tree-watch'
import {
  normalizeTreeRelativePath,
  toWorktreeRelativeDirSet
} from './file-explorer-tree-relative-paths'
import { readFileTreeExpansionSnapshot } from './use-file-tree-expansion-sync'
import { translate } from '@/i18n/i18n'
import type { RightSidebarExplorerView } from '../../../../shared/ui-chrome-types'

function FileExplorerFiles(): React.JSX.Element {
  const explorerView = useAppStore((s) => s.rightSidebarExplorerView)
  const showRightSidebarFiles = useAppStore((s) => s.showRightSidebarFiles)
  const showRightSidebarSearch = useAppStore((s) => s.showRightSidebarSearch)
  const searchPanel = useFileSearchPanel(explorerView)
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const activeWorktree = useActiveWorktree()
  const activeRepo = useRepoById(activeWorktree?.repoId ?? null)
  const collapseAllDirs = useAppStore((s) => s.collapseAllDirs)
  const activeFileId = useAppStore((s) => s.activeFileId)
  const openFiles = useAppStore((s) => s.openFiles)
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen)
  const showDotfiles = useAppStore((s) =>
    activeWorktreeId ? (s.showDotfilesByWorktree[activeWorktreeId] ?? true) : true
  )
  const toggleShowDotfilesForWorktree = useAppStore((s) => s.toggleShowDotfilesForWorktree)
  const showGitIgnoredFiles = useAppStore((s) => s.settings?.showGitIgnoredFiles ?? true)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const expandedCount = useAppStore((s) =>
    activeWorktreeId ? (s.expandedDirs[activeWorktreeId]?.size ?? 0) : 0
  )

  const worktreePath = activeWorktree?.path ?? null
  const isFilesViewActive = explorerView === 'files'
  const visibleFilesWorktreePath = getVisibleFileExplorerWorktreePath({
    explorerView,
    rightSidebarOpen,
    worktreePath
  })
  const repoName = activeRepo?.displayName ?? (worktreePath ? basename(worktreePath) : '')
  const activeRepoSupportsGit = activeRepo ? isGitRepoKind(activeRepo) : false

  const { nameFilterQuery, setNameFilterQuery, hasNameFilter, handleClearNameFilter } =
    useFileExplorerNameFilter({ isFilesViewActive })

  // Why: model creation needs these callbacks up front; the handlers below
  // need the created model, so both route through render-updated refs.
  const selectionHandlerRef = useRef<(paths: readonly string[]) => void>(() => {})
  const renameHandlerRef = useRef<(event: FileTreeRenameEvent) => void>(() => {})
  const canRenameRef = useRef<(item: FileTreeRenamingItem) => boolean>(() => true)
  const canDragRef = useRef<(paths: readonly string[]) => boolean>(() => true)
  const dropCompleteRef = useRef<(event: FileTreeDropResult) => void>(() => {})
  const { model, fileList, refreshFileList, applyExternalFileMutations, getKnownFiles } =
    useFileExplorerTreeModel({
      activeWorktreeId,
      worktreePath,
      enabled: Boolean(visibleFilesWorktreePath),
      activeRepoSupportsGit,
      showDotfiles,
      showGitIgnoredFiles,
      onSelectionChange: (paths) => selectionHandlerRef.current(paths),
      onRename: (event) => renameHandlerRef.current(event),
      canRename: (item) => canRenameRef.current(item),
      canDrag: (paths) => canDragRef.current(paths),
      onDropComplete: (event) => dropCompleteRef.current(event)
    })
  const { selectedPaths, handleSelectionChange, applySelectedPaths } = useFileTreeSelectionBridge({
    model,
    worktreePath
  })
  selectionHandlerRef.current = handleSelectionChange

  const create = useFileTreeCreate({
    model,
    activeWorktreeId,
    worktreePath,
    operationOwner: fileList.operationOwner,
    refreshFileList,
    applyExternalFileMutations
  })
  renameHandlerRef.current = useFileTreeRename({
    activeWorktreeId,
    worktreePath,
    refreshFileList,
    applyExternalFileMutations,
    handleCreateCommit: create.handleRenameCommit
  })
  canRenameRef.current = create.canRename
  dropCompleteRef.current = useFileTreeDrop({
    model,
    activeWorktreeId,
    worktreePath,
    operationOwner: fileList.operationOwner,
    refreshFileList,
    applyExternalFileMutations
  })
  const dragOut = useFileTreeDragOut({ worktreePath, selectedPaths })
  const nativeImport = useFileTreeNativeImport({
    model,
    activeWorktreeId,
    worktreePath,
    operationOwner: fileList.operationOwner,
    refreshFileList,
    applySelectedPaths
  })

  const modelRef = useRef(model)
  modelRef.current = model
  const createPendingRef = useRef(create.isCreatePending)
  createPendingRef.current = create.isCreatePending
  const nativeDragOverRef = useRef(nativeImport.isNativeDragOver)
  nativeDragOverRef.current = nativeImport.isNativeDragOver
  canDragRef.current = () =>
    !createPendingRef.current && !isFileTreeRenameInputActive(modelRef.current)
  const isRenameActive = useCallback(
    () => createPendingRef.current || isFileTreeRenameInputActive(modelRef.current),
    []
  )
  const isInteractionActive = useCallback(
    () => isRenameActive() || nativeDragOverRef.current || dragOut.isRowDragActive(),
    [dragOut, isRenameActive]
  )
  useFileTreeWatch({
    enabled: Boolean(visibleFilesWorktreePath),
    activeWorktreeId,
    worktreePath,
    operationOwner: fileList.operationOwner,
    isInteractionActive,
    getKnownFiles,
    applyExternalFileMutations,
    refreshFileList
  })

  const handleSelectExplorerView = useCallback(
    (view: RightSidebarExplorerView) => {
      if (view === 'files') {
        showRightSidebarFiles()
        return
      }
      const trimmedQuery = nameFilterQuery.trim()
      showRightSidebarSearch(trimmedQuery ? { query: trimmedQuery } : undefined)
    },
    [nameFilterQuery, showRightSidebarFiles, showRightSidebarSearch]
  )

  const manualRefresh = useFileExplorerManualRefresh(
    useCallback(async () => refreshFileList(), [refreshFileList])
  )
  const canCollapseAll = isFilesViewActive && !hasNameFilter && expandedCount > 0
  const handleCollapseAll = useCallback(() => {
    if (!activeWorktreeId || !isFilesViewActive || hasNameFilter) {
      return
    }
    if (model && worktreePath) {
      const stored = useAppStore.getState().expandedDirs[activeWorktreeId] ?? new Set<string>()
      const relativeDirs = new Set([
        ...readFileTreeExpansionSnapshot(model).visibleExpanded,
        ...toWorktreeRelativeDirSet(stored, worktreePath)
      ])
      for (const relativeDir of relativeDirs) {
        const handle = model.getItem(relativeDir)
        if (handle?.isDirectory()) {
          ;(handle as FileTreeDirectoryHandle).collapse()
        }
      }
    }
    collapseAllDirs(activeWorktreeId)
  }, [activeWorktreeId, collapseAllDirs, hasNameFilter, isFilesViewActive, model, worktreePath])
  const handleToggleDotfiles = useCallback(() => {
    if (activeWorktreeId) {
      toggleShowDotfilesForWorktree(activeWorktreeId)
    }
  }, [activeWorktreeId, toggleShowDotfilesForWorktree])
  const toggleGitIgnoredFiles = useCallback(() => {
    void updateSettings({ showGitIgnoredFiles: !showGitIgnoredFiles })
  }, [showGitIgnoredFiles, updateSettings])

  // Why: the global "find in folder" shortcut reads the selected folder off
  // the explorer shell element.
  const selectedFolderRelativePath = useMemo(() => {
    if (!model || !worktreePath || selectedPaths.size !== 1) {
      return undefined
    }
    const relative = getRelativePathInsideRoot([...selectedPaths][0], worktreePath)
    if (!relative) {
      return undefined
    }
    const normalized = normalizeTreeRelativePath(relative)
    return model.getItem(normalized)?.isDirectory() ? normalized : undefined
  }, [model, selectedPaths, worktreePath])

  if (!worktreePath) {
    return (
      <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground px-4 text-center">
        {explorerView === 'search'
          ? translate(
              'auto.components.right.sidebar.Search.98c8435e36',
              'Select a workspace to search'
            )
          : translate(
              'auto.components.right.sidebar.FileExplorer.79b1537dd3',
              'Select a workspace to browse files'
            )}
      </div>
    )
  }

  return (
    <div
      data-orca-explorer-shell
      data-selected-folder-relative-path={selectedFolderRelativePath}
      className="flex min-h-0 flex-1 flex-col"
    >
      <FileExplorerToolbar
        repoName={repoName}
        worktreePath={worktreePath}
        connectionId={activeRepo?.connectionId ?? null}
        refresh={manualRefresh}
        canRefresh={isFilesViewActive}
        canCollapseAll={canCollapseAll}
        onCollapseAll={handleCollapseAll}
        showGitIgnoredFilesToggle={activeRepoSupportsGit}
        showGitIgnoredFiles={showGitIgnoredFiles}
        onToggleGitIgnoredFiles={toggleGitIgnoredFiles}
        showDotfiles={showDotfiles}
        onToggleDotfiles={handleToggleDotfiles}
      />
      <FileExplorerQueryStrip view={explorerView} onSelectView={handleSelectExplorerView}>
        {/* Why: keep both query rows mounted and cross-fade so the Names/Contents
           switch does not remount or shift when changing modes. */}
        <div className="relative min-h-7">
          <div
            className={cn(
              explorerView !== 'files' && 'pointer-events-none invisible absolute inset-x-0 top-0'
            )}
          >
            <FileExplorerNameFilter
              query={nameFilterQuery}
              loading={hasNameFilter && fileList.loading}
              onQueryChange={setNameFilterQuery}
              onClear={handleClearNameFilter}
            />
          </div>
          <div
            className={cn(
              explorerView !== 'search' && 'pointer-events-none invisible absolute inset-x-0 top-0'
            )}
          >
            <SearchQueryRow {...searchPanel.queryRowProps} />
          </div>
        </div>
      </FileExplorerQueryStrip>
      <div
        className={cn(
          'border-b border-border px-2 pb-1.5',
          explorerView !== 'search' &&
            'pointer-events-none invisible h-0 overflow-hidden border-b-0 p-0'
        )}
      >
        <SearchFilters {...searchPanel.filtersProps} />
      </div>
      {/* Why: the Files and Contents views share one body slot; layering them
         avoids remounting heavy panes while preserving full height. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <FileExplorerTreePane
          model={model}
          fileList={fileList}
          refreshFileList={refreshFileList}
          activeRepo={activeRepo}
          activeWorktreeId={activeWorktreeId}
          worktreePath={worktreePath}
          visibleFilesWorktreePath={visibleFilesWorktreePath}
          explorerView={explorerView}
          isFilesViewActive={isFilesViewActive}
          activeFileId={activeFileId}
          openFiles={openFiles}
          nameFilterQuery={nameFilterQuery}
          hasNameFilter={hasNameFilter}
          selectedPaths={selectedPaths}
          applySelectedPaths={applySelectedPaths}
          startNew={create.startNew}
          isCreatePending={create.isCreatePending}
          isRenameActive={isRenameActive}
          nativeDropDir={nativeImport.nativeDropDir}
          isNativeDragOver={nativeImport.isNativeDragOver}
          onNativeDragOver={nativeImport.handleNativeDragOver}
          onNativeDragLeave={nativeImport.handleNativeDragLeave}
          onRowDragStartCapture={dragOut.handleDragStartCapture}
          onRowDragEndCapture={dragOut.handleDragEndCapture}
        />
        <div
          className={cn(
            'absolute inset-0 flex min-h-0 flex-col',
            explorerView !== 'search' && 'pointer-events-none invisible'
          )}
        >
          {searchPanel.activeWorktreeId ? (
            <SearchResultsPane {...searchPanel.resultsProps} />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {translate(
                'auto.components.right.sidebar.Search.98c8435e36',
                'Select a workspace to search'
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const FileExplorerFilesMemo = React.memo(FileExplorerFiles)

function FileExplorer(): React.JSX.Element {
  return <FileExplorerFilesMemo />
}

export default React.memo(FileExplorer)
