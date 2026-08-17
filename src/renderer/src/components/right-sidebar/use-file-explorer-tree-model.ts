import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileTree } from '@pierre/trees'
import type { FileTreeDropResult, FileTreeRenameEvent, FileTreeRenamingItem } from '@pierre/trees'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import {
  useRuntimeFileListForWorktree,
  type RuntimeFileListState
} from '@/components/quick-open-file-list'
import {
  buildFileExplorerTreeGitStatus,
  buildFileExplorerTreeInputPaths,
  passesFileExplorerTreeFilters,
  type FileExplorerTreeInputFilters
} from './file-explorer-tree-input'
import {
  applyTreeFileListMutations,
  buildTreeModelBatchOps,
  type FileExplorerTreeFileMutation
} from './file-explorer-tree-watch-mutations'
import { FILE_EXPLORER_TREE_UNSAFE_CSS } from './file-explorer-tree-theme'
import { toWorktreeRelativeDirSet } from './file-explorer-tree-relative-paths'
import { buildIgnoredSet } from './status-display'
import { useFileExplorerIgnoredPaths } from './use-file-explorer-ignored-paths'

/** Matches the old drag-expand delay for hover-open during internal drags. */
const FILE_TREE_OPEN_ON_DROP_DELAY_MS = 500

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
  refreshFileList: () => void
  /** Reconcile watcher/local mutations into both the model and the flat cache. */
  applyExternalFileMutations: (mutations: readonly FileExplorerTreeFileMutation[]) => void
  /** Current flat cache (relative paths; directories carry a trailing slash). */
  getKnownFiles: () => readonly string[]
}

/** One @pierre/trees model per active worktree, fed from the flat runtime file list. */
export function useFileExplorerTreeModel({
  activeWorktreeId,
  worktreePath,
  enabled,
  activeRepoSupportsGit,
  showDotfiles,
  showGitIgnoredFiles,
  onSelectionChange,
  onRename,
  canRename,
  canDrag,
  onDropComplete
}: UseFileExplorerTreeModelParams): UseFileExplorerTreeModelResult {
  const [refreshToken, setRefreshToken] = useState(0)
  const refreshFileList = useCallback(() => setRefreshToken((token) => token + 1), [])
  const fileList = useRuntimeFileListForWorktree({
    enabled,
    worktreeId: activeWorktreeId,
    refreshToken
  })

  const ignoredPaths = useFileExplorerIgnoredPaths({
    activeWorktreeId,
    canLoadIgnoredPaths:
      activeRepoSupportsGit && enabled && Boolean(worktreePath) && fileList.files.length > 0,
    relativePaths: fileList.files,
    shouldDebounceIgnoredQuery: false,
    worktreePath
  })
  const ignoredSet = useMemo(() => buildIgnoredSet(ignoredPaths), [ignoredPaths])
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

  // Flat cache: watcher/local mutations keep it in step with the model so the
  // next filter-driven reset cannot resurrect deleted paths.
  const knownFilesRef = useRef<readonly string[]>([])
  const lastSyncedFilesRef = useRef<readonly string[] | null>(null)
  const lastResetSignatureRef = useRef<string | null>(null)
  const relistDirtyRef = useRef(false)
  const fileListLoadingRef = useRef(fileList.loading)
  fileListLoadingRef.current = fileList.loading

  const [model, setModel] = useState<FileTree | null>(null)
  useEffect(() => {
    if (!activeWorktreeId) {
      setModel(null)
      return
    }
    lastResetSignatureRef.current = null
    const created = new FileTree({
      paths: [],
      initialExpansion: 'closed',
      flattenEmptyDirectories: false,
      stickyFolders: false,
      // Why: Orca's own name-filter input drives model.setSearch(); the
      // library's built-in search UI stays off.
      search: false,
      fileTreeSearchMode: 'hide-non-matches',
      onSelectionChange: (paths) => onSelectionChangeRef.current(paths),
      renaming: {
        canRename: (item) => canRenameRef.current(item),
        onRename: (event) => onRenameRef.current(event),
        onError: (error) => toast.error(error)
      },
      dragAndDrop: {
        canDrag: (paths) => canDragRef.current(paths),
        onDropComplete: (event) => onDropCompleteRef.current(event),
        onDropError: (error) => toast.error(error),
        openOnDropDelay: FILE_TREE_OPEN_ON_DROP_DELAY_MS
      },
      composition: {
        contextMenu: {
          enabled: true,
          triggerMode: 'both',
          // Why: right-clicking outside the current multi-selection retargets
          // it, mirroring the old explorer's context-menu selection rules.
          onOpen: (item) => {
            if (!created.getSelectedPaths().includes(item.path)) {
              for (const selected of created.getSelectedPaths()) {
                created.getItem(selected)?.deselect()
              }
              created.getItem(item.path)?.select()
            }
          }
        }
      },
      unsafeCSS: FILE_EXPLORER_TREE_UNSAFE_CSS
    })
    setModel(created)
    return () => {
      created.cleanUp()
    }
  }, [activeWorktreeId])

  // Why: reset by content signature only — expansion state is read from the
  // store at reset time, so expanding a folder never triggers a tree rebuild.
  useEffect(() => {
    if (!model || !activeWorktreeId || !worktreePath) {
      return
    }
    if (lastSyncedFilesRef.current !== fileList.files) {
      lastSyncedFilesRef.current = fileList.files
      knownFilesRef.current = fileList.files
      if (relistDirtyRef.current && !fileList.loading) {
        // Why: mutations applied mid-relist may be missing from that scan.
        relistDirtyRef.current = false
        refreshFileList()
      }
    }
    const inputPaths = buildFileExplorerTreeInputPaths(knownFilesRef.current, filters)
    const signature = inputPaths.join('\n')
    if (signature === lastResetSignatureRef.current) {
      return
    }
    lastResetSignatureRef.current = signature
    const expanded = useAppStore.getState().expandedDirs[activeWorktreeId] ?? new Set<string>()
    model.resetPaths(inputPaths, {
      initialExpandedPaths: [...toWorktreeRelativeDirSet(expanded, worktreePath)]
    })
  }, [
    model,
    activeWorktreeId,
    worktreePath,
    fileList.files,
    fileList.loading,
    filters,
    refreshFileList
  ])

  const applyExternalFileMutations = useCallback(
    (mutations: readonly FileExplorerTreeFileMutation[]) => {
      if (!model || mutations.length === 0) {
        return
      }
      knownFilesRef.current = applyTreeFileListMutations(knownFilesRef.current, mutations)
      if (fileListLoadingRef.current) {
        relistDirtyRef.current = true
      }
      const currentFilters = filtersRef.current
      const ops = buildTreeModelBatchOps(model, mutations, (relativePath) =>
        passesFileExplorerTreeFilters(relativePath, currentFilters)
      )
      if (ops === null) {
        refreshFileList()
        return
      }
      try {
        if (ops.length > 0) {
          model.batch(ops)
        }
      } catch {
        // Why: a mutation the model rejects means our view of it drifted; relist.
        refreshFileList()
        return
      }
      lastResetSignatureRef.current = buildFileExplorerTreeInputPaths(
        knownFilesRef.current,
        currentFilters
      ).join('\n')
    },
    [model, refreshFileList]
  )

  const getKnownFiles = useCallback((): readonly string[] => knownFilesRef.current, [])

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
    const visibleIgnoredPaths = showGitIgnoredFiles ? [...ignoredSet] : []
    model.setGitStatus(buildFileExplorerTreeGitStatus(gitStatusEntries ?? [], visibleIgnoredPaths))
  }, [model, activeRepoSupportsGit, gitStatusEntries, ignoredSet, showGitIgnoredFiles])

  return {
    model,
    fileList,
    ignoredSet,
    refreshFileList,
    applyExternalFileMutations,
    getKnownFiles
  }
}
