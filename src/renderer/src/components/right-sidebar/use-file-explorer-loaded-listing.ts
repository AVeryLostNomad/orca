import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import type { RuntimeFileListState } from '@/components/quick-open-file-list'
import { cleanRuntimeFileListError } from '@/components/runtime-file-list-error'
import {
  createFileExplorerDirReader,
  partitionDirLoads,
  readFileExplorerDirs,
  trackInFlightDirLoad,
  readFileExplorerIgnoredPaths
} from './file-explorer-dir-reads'
import {
  applyDirReadsToLoadedListing,
  applyMutationsToLoadedListing,
  assembleLoadedListing,
  dirEntriesToKnownPaths,
  mergeIgnoredPaths,
  replayWaveEntry,
  selectExpandedDirChain,
  type LoadedListing,
  type WaveReplayEntry
} from './file-explorer-loaded-listing'
import {
  getFileExplorerOperationOwner,
  getFileExplorerOwnerUnresolvedMessage
} from './file-explorer-operation-owner'
import type { FileExplorerTreeFileMutation } from './file-explorer-tree-watch-mutations'
import { toWorktreeRelativeDirSet } from './file-explorer-tree-relative-paths'
import type { FileExplorerOperationOwner } from './file-explorer-types'
import { useFileExplorerListingTriggers } from './use-file-explorer-listing-triggers'

const EMPTY_LISTING: LoadedListing = { files: [], loadedDirs: new Set() }

export type FileExplorerDirsLoadedEvent = {
  mutations: readonly FileExplorerTreeFileMutation[]
  /** Includes the new children's classification when it was awaited. */
  ignoredSet: ReadonlySet<string>
}

type UseFileExplorerLoadedListingParams = {
  enabled: boolean
  activeWorktreeId: string | null
  worktreePath: string | null
  activeRepoSupportsGit: boolean
  /** Hidden ignored rows must be classified before they reach the tree, or they flash. */
  hideIgnored: boolean
  /** Incremental folder loads, applied to the model without a reset. */
  onDirsLoaded: (event: FileExplorerDirsLoadedEvent) => void
}

export type FileExplorerLoadedListingApi = {
  fileList: RuntimeFileListState
  ignoredSet: Set<string>
  /** New identity whenever the cache is replaced or grows. */
  listingVersion: object
  getKnownFiles: () => readonly string[]
  isDirLoaded: (relativeDir: string) => boolean
  /** Scope watcher/local mutations to loaded folders, record them, and return the scoped set. */
  applyMutations: (
    mutations: readonly FileExplorerTreeFileMutation[]
  ) => FileExplorerTreeFileMutation[]
  /** Resolves once every requested folder is listed (or has failed). */
  loadDirs: (relativeDirs: readonly string[]) => Promise<void>
  /** Re-read the root and every loaded folder. */
  refresh: () => Promise<void>
}

/**
 * Directory-at-a-time listing for the explorer: the root and expanded folders
 * are read on demand, so repository size never caps what the tree can show.
 */
export function useFileExplorerLoadedListing({
  enabled,
  activeWorktreeId,
  worktreePath,
  activeRepoSupportsGit,
  hideIgnored,
  onDirsLoaded
}: UseFileExplorerLoadedListingParams): FileExplorerLoadedListingApi {
  const listingRef = useRef<LoadedListing>(EMPTY_LISTING)
  const [snapshot, setSnapshot] = useState<{ files: string[] }>({ files: [] })
  const publish = useCallback(() => setSnapshot({ files: listingRef.current.files }), [])
  const ignoredRef = useRef<Set<string>>(new Set())
  const [ignoredSet, setIgnoredSet] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [operationOwner, setOperationOwner] = useState<FileExplorerOperationOwner>({
    kind: 'unresolved'
  })

  // Why: worktree switches bump the epoch so late reads cannot land in the next tree.
  const epochRef = useRef(0)
  const waveIdRef = useRef(0)
  // Changes applied while a refresh is reading are replayed onto its result.
  const waveLogRef = useRef<WaveReplayEntry[] | null>(null)
  const inFlightRef = useRef(new Map<string, Promise<void>>())
  // Unreadable or vanished folders; retried after a collapse/re-expand or a refresh.
  const failedDirsRef = useRef(new Set<string>())

  const targetRef = useRef({ activeWorktreeId, worktreePath })
  targetRef.current = { activeWorktreeId, worktreePath }
  const hideIgnoredRef = useRef(hideIgnored)
  hideIgnoredRef.current = hideIgnored
  const gitRef = useRef(activeRepoSupportsGit)
  gitRef.current = activeRepoSupportsGit
  const onDirsLoadedRef = useRef(onDirsLoaded)
  onDirsLoadedRef.current = onDirsLoaded

  const mergeIgnored = useCallback(
    (checkedPaths: readonly string[], ignoredPaths: readonly string[]): Set<string> => {
      ignoredRef.current = mergeIgnoredPaths(ignoredRef.current, checkedPaths, ignoredPaths)
      setIgnoredSet(ignoredRef.current)
      return ignoredRef.current
    },
    []
  )

  useEffect(() => {
    epochRef.current += 1
    listingRef.current = EMPTY_LISTING
    ignoredRef.current = new Set()
    inFlightRef.current.clear()
    failedDirsRef.current.clear()
    waveLogRef.current = null
    setIgnoredSet(new Set())
    setLoadError(null)
    publish()
    return () => {
      epochRef.current += 1
    }
  }, [activeWorktreeId, worktreePath, publish])

  const refresh = useCallback(async (): Promise<void> => {
    const { activeWorktreeId: worktreeId, worktreePath: root } = targetRef.current
    if (!worktreeId || !root) {
      return
    }
    const epoch = epochRef.current
    const waveId = ++waveIdRef.current
    const isCurrent = (): boolean => epochRef.current === epoch && waveIdRef.current === waveId
    const owner = getFileExplorerOperationOwner(worktreeId)
    const read = createFileExplorerDirReader(worktreeId, root, owner)
    if (!read) {
      setLoadError(getFileExplorerOwnerUnresolvedMessage())
      setLoading(false)
      return
    }
    waveLogRef.current = []
    setLoading(true)
    const expanded = toWorktreeRelativeDirSet(
      useAppStore.getState().expandedDirs[worktreeId] ?? [],
      root
    )
    const dirs = [
      ...new Set(['', ...listingRef.current.loadedDirs, ...selectExpandedDirChain(expanded)])
    ]
    const { listings, failures } = await readFileExplorerDirs(read, dirs)
    if (!isCurrent()) {
      return
    }
    if (!listings.has('')) {
      waveLogRef.current = null
      setLoadError(cleanRuntimeFileListError(failures.get('')))
      setLoading(false)
      return
    }
    const assembled = assembleLoadedListing(listings)
    const ignoredQuery = gitRef.current
      ? readFileExplorerIgnoredPaths(worktreeId, root, assembled.files)
      : null
    const awaitedIgnored = ignoredQuery && hideIgnoredRef.current ? await ignoredQuery : null
    if (!isCurrent()) {
      return
    }
    let next: LoadedListing = assembled
    for (const entry of waveLogRef.current ?? []) {
      next = replayWaveEntry(next, entry)
    }
    waveLogRef.current = null
    listingRef.current = next
    failedDirsRef.current = new Set(failures.keys())
    if (awaitedIgnored) {
      mergeIgnored(assembled.files, awaitedIgnored)
    }
    setOperationOwner(owner)
    setLoadError(null)
    setLoading(false)
    publish()
    if (ignoredQuery && !awaitedIgnored) {
      const ignoredPaths = await ignoredQuery
      if (epochRef.current === epoch) {
        mergeIgnored(assembled.files, ignoredPaths)
      }
    }
  }, [mergeIgnored, publish])

  const loadDirs = useCallback(
    (relativeDirs: readonly string[]): Promise<void> => {
      const { activeWorktreeId: worktreeId, worktreePath: root } = targetRef.current
      if (!worktreeId || !root) {
        return Promise.resolve()
      }
      const { waiting, pending } = partitionDirLoads(
        relativeDirs,
        inFlightRef.current,
        listingRef.current.loadedDirs
      )
      if (pending.length === 0) {
        return Promise.all(waiting).then(() => undefined)
      }

      const epoch = epochRef.current
      const load = async (): Promise<void> => {
        const read = createFileExplorerDirReader(
          worktreeId,
          root,
          getFileExplorerOperationOwner(worktreeId)
        )
        if (!read) {
          return
        }
        const { listings, failures } = await readFileExplorerDirs(read, pending)
        if (epochRef.current !== epoch) {
          return
        }
        for (const [dir, error] of failures) {
          failedDirsRef.current.add(dir)
          console.warn('[file-explorer] could not list folder', dir, error)
        }
        const childPaths = [...listings].flatMap(([dir, entries]) =>
          dirEntriesToKnownPaths(dir, entries)
        )
        const ignoredQuery = gitRef.current
          ? readFileExplorerIgnoredPaths(worktreeId, root, childPaths)
          : null
        const awaitedIgnored = ignoredQuery && hideIgnoredRef.current ? await ignoredQuery : null
        if (epochRef.current !== epoch) {
          return
        }
        const applied = applyDirReadsToLoadedListing(listingRef.current, listings)
        listingRef.current = applied.listing
        for (const dir of applied.unattachedDirs) {
          failedDirsRef.current.add(dir)
        }
        waveLogRef.current?.push(...applied.replayEntries)
        const { mutations } = applied
        const currentIgnored = awaitedIgnored
          ? mergeIgnored(childPaths, awaitedIgnored)
          : ignoredRef.current
        if (mutations.length > 0) {
          onDirsLoadedRef.current({ mutations, ignoredSet: currentIgnored })
        }
        publish()
        if (ignoredQuery && !awaitedIgnored) {
          void ignoredQuery.then((ignoredPaths) => {
            if (epochRef.current === epoch) {
              mergeIgnored(childPaths, ignoredPaths)
            }
          })
        }
      }
      const promise = load().catch((error: unknown) => {
        console.warn('[file-explorer] folder load failed', error)
      })
      trackInFlightDirLoad(inFlightRef.current, pending, promise)
      waiting.push(promise)
      return Promise.all(waiting).then(() => undefined)
    },
    [mergeIgnored, publish]
  )

  const applyMutations = useCallback(
    (mutations: readonly FileExplorerTreeFileMutation[]): FileExplorerTreeFileMutation[] => {
      const applied = applyMutationsToLoadedListing(listingRef.current, mutations)
      listingRef.current = { files: applied.files, loadedDirs: applied.loadedDirs }
      if (applied.scoped.length > 0) {
        waveLogRef.current?.push({ kind: 'mutations', mutations: applied.scoped })
      }
      return applied.scoped
    },
    []
  )

  const { connectionPending } = useFileExplorerListingTriggers({
    enabled,
    activeWorktreeId,
    worktreePath,
    listingVersion: snapshot,
    refresh,
    loadDirs,
    getDirLoadState: () => ({
      loadedDirs: listingRef.current.loadedDirs,
      failedDirs: failedDirsRef.current,
      inFlightDirs: inFlightRef.current
    })
  })

  const getKnownFiles = useCallback((): readonly string[] => listingRef.current.files, [])
  const isDirLoaded = useCallback(
    (relativeDir: string): boolean => listingRef.current.loadedDirs.has(relativeDir),
    []
  )
  const fileList = useMemo<RuntimeFileListState>(
    () => ({
      files: snapshot.files,
      loading: loading || connectionPending,
      loadError,
      operationOwner
    }),
    [connectionPending, loadError, loading, operationOwner, snapshot]
  )

  return {
    fileList,
    ignoredSet,
    listingVersion: snapshot,
    getKnownFiles,
    isDirLoaded,
    applyMutations,
    loadDirs,
    refresh
  }
}
