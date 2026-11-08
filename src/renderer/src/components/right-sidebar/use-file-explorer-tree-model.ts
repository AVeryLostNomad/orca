import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  FileTree,
  FileTreeDropResult,
  FileTreeRenameEvent,
  FileTreeRenamingItem
} from '@pierre/trees'
import { useAppStore } from '@/store'
import {
  useRuntimeFileListForWorktree,
  type RuntimeFileListState
} from '@/components/quick-open-file-list'
import { isFileNameFilterQueryTooLarge } from '../../../../shared/file-name-filter-tokens'
import {
  buildFileExplorerTreeInputPaths,
  passesFileExplorerTreeFilters,
  type FileExplorerTreeInputFilters
} from './file-explorer-tree-input'
import type { FileExplorerTreeFileMutation } from './file-explorer-tree-watch-mutations'
import { buildTreeModelBatchOps } from './file-explorer-tree-batch-operations'
import { createFileExplorerTree } from './create-file-explorer-tree'
import {
  toWorktreeRelativeDirSet,
  toWorktreeRelativePath
} from './file-explorer-tree-relative-paths'
import { scopeTreeInputPaths, scopeTreeMutations } from './file-explorer-tree-scope'
import {
  expandRestoredTreeDirs,
  useFileTreeContentReset,
  useFileTreeGitStatus
} from './use-file-tree-model-sync'
import {
  useFileExplorerLoadedListing,
  type FileExplorerDirsLoadedEvent
} from './use-file-explorer-loaded-listing'
import { useHiddenUnityMetaRoots } from '@/components/unity/use-hidden-unity-meta-roots'

/** Narrow model surface the explorer hooks depend on, so tests can mock it. */
export type FileTreeModelLike = Pick<
  FileTree,
  | 'getItem'
  | 'getVisibleCount'
  | 'getVisibleRows'
  | 'getSelectedPaths'
  | 'getFocusedPath'
  | 'subscribe'
  | 'scrollToPath'
  | 'focusPath'
  | 'setSearch'
  | 'getSearchValue'
  | 'getSearchMatchingPaths'
  | 'setGitStatus'
  | 'resetPaths'
  | 'startRenaming'
  | 'add'
  | 'remove'
  | 'move'
  | 'batch'
  | 'getFileTreeContainer'
>

type UseFileExplorerTreeModelParams = {
  activeWorktreeId: string | null
  worktreePath: string | null
  /** Directory the tree is rooted at (a Unity Assets/Packages scope); defaults to the worktree. */
  treeRootPath?: string | null
  enabled: boolean
  activeRepoSupportsGit: boolean
  showDotfiles: boolean
  showGitIgnoredFiles: boolean
  /** Trimmed name-filter query; non-empty lists the whole worktree so matches outside loaded folders show. */
  nameFilterQuery: string
  onSelectionChange: (relativePaths: readonly string[]) => void
  onRename: (event: FileTreeRenameEvent) => void
  canRename: (item: FileTreeRenamingItem) => boolean
  canDrag: (paths: readonly string[]) => boolean
  onDropComplete: (event: FileTreeDropResult) => void
}

type UseFileExplorerTreeModelResult = {
  model: FileTree | null
  fileList: RuntimeFileListState
  ignoredSet: Set<string>
  /** Whole-worktree listing backing the name filter. */
  nameFilterLoading: boolean
  refreshFileList: () => void
  /** Manual refresh: resolves once the root and every loaded folder are re-read. */
  refreshLoadedDirs: () => Promise<void>
  /** Reconcile watcher/local mutations into both the model and the flat cache. */
  applyExternalFileMutations: (mutations: readonly FileExplorerTreeFileMutation[]) => void
  /** Current flat cache (relative paths; directories carry a trailing slash). */
  getKnownFiles: () => readonly string[]
  isDirLoaded: (relativeDir: string) => boolean
  loadDirs: (relativeDirs: readonly string[]) => Promise<void>
}

const EMPTY_PATHS: string[] = []

/** One @pierre/trees model per active worktree, fed folder-by-folder as directories expand. */
export function useFileExplorerTreeModel({
  activeWorktreeId,
  worktreePath,
  treeRootPath = worktreePath,
  enabled,
  activeRepoSupportsGit,
  showDotfiles,
  showGitIgnoredFiles,
  nameFilterQuery,
  onSelectionChange,
  onRename,
  canRename,
  canDrag,
  onDropComplete
}: UseFileExplorerTreeModelParams): UseFileExplorerTreeModelResult {
  const modelRef = useRef<FileTree | null>(null)
  const dirsLoadedHandlerRef = useRef<(event: FileExplorerDirsLoadedEvent) => void>(() => {})
  const scopePrefix =
    worktreePath && treeRootPath ? toWorktreeRelativePath(treeRootPath, worktreePath) : ''
  const scopePrefixRef = useRef(scopePrefix)
  scopePrefixRef.current = scopePrefix
  const listing = useFileExplorerLoadedListing({
    enabled,
    activeWorktreeId,
    worktreePath,
    scopePrefix,
    activeRepoSupportsGit,
    hideIgnored: activeRepoSupportsGit && !showGitIgnoredFiles,
    onDirsLoaded: (event) => dirsLoadedHandlerRef.current(event)
  })
  const { ignoredSet, getKnownFiles, refresh, applyMutations } = listing
  const refreshFileList = useCallback(() => {
    void refresh()
  }, [refresh])

  const nameFilterEnabled =
    enabled && nameFilterQuery.length > 0 && !isFileNameFilterQueryTooLarge(nameFilterQuery)
  const nameFilterList = useRuntimeFileListForWorktree({
    enabled: nameFilterEnabled,
    worktreeId: activeWorktreeId,
    // Why: SSH/runtime hosts answer a query with a top-N path search; their capped full listing serves the filter better.
    query: listing.fileList.operationOwner?.kind === 'local' ? nameFilterQuery : undefined,
    hostFilterWhenCapped: true
  })
  const nameFilterFiles = nameFilterEnabled ? nameFilterList.files : EMPTY_PATHS
  const nameFilterFilesRef = useRef(nameFilterFiles)
  nameFilterFilesRef.current = nameFilterFiles

  const hiddenUnityMetaRoots = useHiddenUnityMetaRoots(activeWorktreeId, worktreePath)
  const filters = useMemo<FileExplorerTreeInputFilters>(
    () => ({ showDotfiles, showGitIgnoredFiles, ignoredSet, hiddenUnityMetaRoots }),
    [ignoredSet, showDotfiles, showGitIgnoredFiles, hiddenUnityMetaRoots]
  )
  const filtersRef = useRef(filters)
  filtersRef.current = filters

  const onSelectionChangeRef = useRef(onSelectionChange)
  onSelectionChangeRef.current = onSelectionChange
  const onRenameRef = useRef(onRename)
  onRenameRef.current = onRename
  const canRenameRef = useRef(canRename)
  canRenameRef.current = canRename
  const canDragRef = useRef(canDrag)
  canDragRef.current = canDrag
  const onDropCompleteRef = useRef(onDropComplete)
  onDropCompleteRef.current = onDropComplete

  const lastResetSignatureRef = useRef<string | null>(null)
  // Why: name-filter matches outside loaded folders join the model only while filtering.
  const buildInputPaths = useCallback(
    (inputFilters: FileExplorerTreeInputFilters): string[] => {
      const known = getKnownFiles()
      const extra = nameFilterFilesRef.current
      const listed = extra.length > 0 ? [...known, ...extra] : known
      return scopeTreeInputPaths(
        scopePrefixRef.current,
        buildFileExplorerTreeInputPaths(listed, inputFilters)
      )
    },
    [getKnownFiles]
  )

  const [model, setModel] = useState<FileTree | null>(null)
  useEffect(() => {
    if (!activeWorktreeId) {
      setModel(null)
      return
    }
    lastResetSignatureRef.current = null
    const created = createFileExplorerTree({
      onSelectionChange: (paths) => onSelectionChangeRef.current(paths),
      canRename: (item) => canRenameRef.current(item),
      onRename: (event) => onRenameRef.current(event),
      canDrag: (paths) => canDragRef.current(paths),
      onDropComplete: (event) => onDropCompleteRef.current(event)
    })
    modelRef.current = created
    setModel(created)
    return () => {
      modelRef.current = null
      created.cleanUp()
    }
  }, [activeWorktreeId, treeRootPath])

  useFileTreeContentReset({
    model,
    activeWorktreeId,
    treeRootPath,
    contentVersion: useMemo(
      () => [listing.listingVersion, nameFilterFiles, filters],
      [listing.listingVersion, nameFilterFiles, filters]
    ),
    buildInputPaths: () => buildInputPaths(filters),
    lastResetSignatureRef
  })
  const { isDirLoaded, loadDirs } = listing

  const applyModelMutations = useCallback(
    (
      mutations: readonly FileExplorerTreeFileMutation[],
      currentFilters: FileExplorerTreeInputFilters
    ): boolean => {
      const target = modelRef.current
      if (!target) {
        return true
      }
      const prefix = scopePrefixRef.current
      const scoped = scopeTreeMutations(prefix, mutations)
      if (scoped === null) {
        return false
      }
      const ops = buildTreeModelBatchOps(target, scoped, (treePath) =>
        passesFileExplorerTreeFilters(prefix ? `${prefix}/${treePath}` : treePath, currentFilters)
      )
      if (ops === null) {
        return false
      }
      try {
        if (ops.length > 0) {
          target.batch(ops)
        }
      } catch (error) {
        console.warn('[file-explorer] tree mutation batch failed; relisting', error)
        return false
      }
      lastResetSignatureRef.current = buildInputPaths(currentFilters).join('\n')
      return true
    },
    [buildInputPaths]
  )

  const applyExternalFileMutations = useCallback(
    (mutations: readonly FileExplorerTreeFileMutation[]) => {
      if (!model || mutations.length === 0) {
        return
      }
      const scoped = applyMutations(mutations)
      if (scoped.length > 0 && !applyModelMutations(scoped, filtersRef.current)) {
        lastResetSignatureRef.current = null
        refreshFileList()
      }
    },
    [applyModelMutations, applyMutations, model, refreshFileList]
  )

  dirsLoadedHandlerRef.current = ({ mutations, ignoredSet: loadedIgnoredSet }) => {
    const target = modelRef.current
    if (!target || !activeWorktreeId || !worktreePath || !treeRootPath) {
      return
    }
    const currentFilters = {
      ...filtersRef.current,
      ignoredSet: new Set(loadedIgnoredSet)
    }
    if (!applyModelMutations(mutations, currentFilters)) {
      lastResetSignatureRef.current = null
      refreshFileList()
      return
    }
    expandRestoredTreeDirs(
      target,
      scopeTreeMutations(scopePrefix, mutations) ?? [],
      toWorktreeRelativeDirSet(
        useAppStore.getState().expandedDirs[activeWorktreeId] ?? [],
        treeRootPath
      )
    )
  }

  useFileTreeGitStatus({
    model,
    activeWorktreeId,
    activeRepoSupportsGit,
    showGitIgnoredFiles,
    ignoredSet,
    scopePrefix
  })

  return {
    model,
    fileList: listing.fileList,
    ignoredSet,
    nameFilterLoading: nameFilterEnabled && nameFilterList.loading,
    refreshFileList,
    refreshLoadedDirs: refresh,
    applyExternalFileMutations,
    getKnownFiles,
    isDirLoaded,
    loadDirs
  }
}
