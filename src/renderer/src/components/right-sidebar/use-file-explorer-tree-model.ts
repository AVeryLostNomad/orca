import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  FileTree,
  FileTreeDirectoryHandle,
  FileTreeDropResult,
  FileTreeItemHandle,
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
  buildFileExplorerTreeGitStatus,
  buildFileExplorerTreeInputPaths,
  passesFileExplorerTreeFilters,
  type FileExplorerTreeInputFilters
} from './file-explorer-tree-input'
import type { FileExplorerTreeFileMutation } from './file-explorer-tree-watch-mutations'
import { buildTreeModelBatchOps } from './file-explorer-tree-batch-operations'
import { createFileExplorerTree } from './create-file-explorer-tree'
import { getParentRelativeDir } from './file-explorer-loaded-dir-scope'
import { toWorktreeRelativeDirSet } from './file-explorer-tree-relative-paths'
import {
  useFileExplorerLoadedListing,
  type FileExplorerDirsLoadedEvent
} from './use-file-explorer-loaded-listing'
import { resetFileTreePathsWithExpansion } from './use-file-tree-expansion-sync'

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

function asDirectoryHandle(handle: FileTreeItemHandle | null): FileTreeDirectoryHandle | null {
  return handle && 'expand' in handle ? handle : null
}

/** One @pierre/trees model per active worktree, fed folder-by-folder as directories expand. */
export function useFileExplorerTreeModel({
  activeWorktreeId,
  worktreePath,
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
  const listing = useFileExplorerLoadedListing({
    enabled,
    activeWorktreeId,
    worktreePath,
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

  const filters = useMemo<FileExplorerTreeInputFilters>(
    () => ({ showDotfiles, showGitIgnoredFiles, ignoredSet }),
    [ignoredSet, showDotfiles, showGitIgnoredFiles]
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
      return buildFileExplorerTreeInputPaths(
        extra.length > 0 ? [...known, ...extra] : known,
        inputFilters
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
  }, [activeWorktreeId])

  // Why: reset by content signature only — expansion state is read from the
  // store at reset time, so expanding a folder never triggers a tree rebuild.
  useEffect(() => {
    if (!model || !activeWorktreeId || !worktreePath) {
      return
    }
    const inputPaths = buildInputPaths(filters)
    const signature = inputPaths.join('\n')
    if (signature === lastResetSignatureRef.current) {
      return
    }
    const expanded = useAppStore.getState().expandedDirs[activeWorktreeId] ?? new Set<string>()
    resetFileTreePathsWithExpansion(
      model,
      inputPaths,
      toWorktreeRelativeDirSet(expanded, worktreePath)
    )
    lastResetSignatureRef.current = signature
  }, [
    model,
    activeWorktreeId,
    worktreePath,
    listing.listingVersion,
    nameFilterFiles,
    filters,
    buildInputPaths
  ])

  const applyModelMutations = useCallback(
    (
      mutations: readonly FileExplorerTreeFileMutation[],
      currentFilters: FileExplorerTreeInputFilters
    ): boolean => {
      const target = modelRef.current
      if (!target) {
        return true
      }
      const ops = buildTreeModelBatchOps(target, mutations, (relativePath) =>
        passesFileExplorerTreeFilters(relativePath, currentFilters)
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
    if (!target || !activeWorktreeId || !worktreePath) {
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
    // Why: re-open newly listed folders the user had expanded before the
    // expansion sync sees them collapsed and forgets them.
    const expanded = toWorktreeRelativeDirSet(
      useAppStore.getState().expandedDirs[activeWorktreeId] ?? [],
      worktreePath
    )
    for (const mutation of mutations) {
      if (mutation.kind !== 'create' || !mutation.isDirectory) {
        continue
      }
      if (!expanded.has(mutation.relativePath)) {
        continue
      }
      const parent = getParentRelativeDir(mutation.relativePath)
      // Why: expand() opens collapsed ancestors too, so only follow an open parent.
      if (parent && !asDirectoryHandle(target.getItem(parent))?.isExpanded()) {
        continue
      }
      asDirectoryHandle(target.getItem(mutation.relativePath))?.expand()
    }
  }

  const gitStatusEntries = useAppStore((s) =>
    activeWorktreeId ? s.gitStatusByWorktree[activeWorktreeId] : undefined
  )
  useEffect(() => {
    if (!model) {
      return
    }
    if (!activeRepoSupportsGit) {
      model.setGitStatus([])
      return
    }
    // Why: a trailing slash tells the library an ignored path is a folder so its row dims too.
    const visibleIgnoredPaths = showGitIgnoredFiles
      ? [...ignoredSet].map((path) => (model.getItem(path)?.isDirectory() ? `${path}/` : path))
      : []
    model.setGitStatus(buildFileExplorerTreeGitStatus(gitStatusEntries ?? [], visibleIgnoredPaths))
  }, [model, activeRepoSupportsGit, gitStatusEntries, ignoredSet, showGitIgnoredFiles])

  return {
    model,
    fileList: listing.fileList,
    ignoredSet,
    nameFilterLoading: nameFilterEnabled && nameFilterList.loading,
    refreshFileList,
    refreshLoadedDirs: refresh,
    applyExternalFileMutations,
    getKnownFiles,
    isDirLoaded: listing.isDirLoaded,
    loadDirs: listing.loadDirs
  }
}
