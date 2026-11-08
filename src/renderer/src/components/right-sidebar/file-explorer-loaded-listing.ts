import type { DirEntry } from '../../../../shared/filesystem-entry-types'
import { shouldIncludeFileExplorerEntry } from './file-explorer-entries'
import { buildIgnoredSet } from './status-display'
import { getParentRelativeDir, scopeMutationsToLoadedDirs } from './file-explorer-loaded-dir-scope'
import {
  applyTreeFileListMutations,
  type FileExplorerTreeFileMutation
} from './file-explorer-tree-watch-mutations'

/**
 * The explorer lists one directory at a time. The flat cache holds the direct
 * children of every loaded directory (worktree-relative, directories with a
 * trailing slash); an unloaded directory appears only as its own `dir/` entry.
 * '' is the worktree root.
 */
export type LoadedListing = {
  files: string[]
  loadedDirs: ReadonlySet<string>
}

export function dirEntriesToKnownPaths(dirRel: string, entries: readonly DirEntry[]): string[] {
  const prefix = dirRel ? `${dirRel}/` : ''
  const paths: string[] = []
  for (const entry of entries) {
    if (shouldIncludeFileExplorerEntry(entry)) {
      paths.push(entry.isDirectory ? `${prefix}${entry.name}/` : `${prefix}${entry.name}`)
    }
  }
  return paths
}

/** Direct child of `prefix` → its first segment; deeper descendant → null; anything else → undefined. */
function directChildName(file: string, prefix: string): string | null | undefined {
  if (!file.startsWith(prefix) || file.length === prefix.length) {
    return undefined
  }
  const slash = file.indexOf('/', prefix.length)
  return slash === -1 || slash === file.length - 1 ? file.slice(prefix.length) : null
}

export type DirListingMerge = {
  files: string[]
  /** Tree mutations that turn the previous children into the new ones. */
  mutations: FileExplorerTreeFileMutation[]
  /** Child directories that vanished (or became files); their loaded state is stale. */
  removedDirs: string[]
}

/** Replace one directory's direct children in O(files); surviving child dirs keep their loaded descendants. */
export function mergeDirListing(
  files: readonly string[],
  dirRel: string,
  childPaths: readonly string[]
): DirListingMerge {
  const prefix = dirRel ? `${dirRel}/` : ''
  const nextChildren = new Set(childPaths)
  const presentChildren = new Set<string>()
  const removedDirs: string[] = []
  const removedDirPrefixes = new Set<string>()
  const mutations: FileExplorerTreeFileMutation[] = []
  for (const file of files) {
    if (directChildName(file, prefix) == null) {
      continue
    }
    if (nextChildren.has(file)) {
      presentChildren.add(file)
      continue
    }
    const isDirectory = file.endsWith('/')
    const relativePath = isDirectory ? file.slice(0, -1) : file
    mutations.push({ kind: 'delete', relativePath, isDirectory })
    if (isDirectory) {
      removedDirs.push(relativePath)
      removedDirPrefixes.add(file)
    }
  }

  const result: string[] = []
  for (const file of files) {
    const child = directChildName(file, prefix)
    if (child === undefined) {
      result.push(file)
    } else if (child === null) {
      const childDir = file.slice(0, file.indexOf('/', prefix.length) + 1)
      if (!removedDirPrefixes.has(childDir)) {
        result.push(file)
      }
    } else if (nextChildren.has(file)) {
      result.push(file)
    }
  }
  for (const child of childPaths) {
    if (!presentChildren.has(child)) {
      result.push(child)
      const isDirectory = child.endsWith('/')
      mutations.push({
        kind: 'create',
        relativePath: isDirectory ? child.slice(0, -1) : child,
        isDirectory
      })
    }
  }
  return { files: result, mutations, removedDirs }
}

function isSameOrDescendant(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`)
}

export function withoutLoadedDirsUnder(
  loadedDirs: ReadonlySet<string>,
  dirs: readonly string[]
): Set<string> {
  const next = new Set<string>()
  for (const loaded of loadedDirs) {
    if (!dirs.some((dir) => isSameOrDescendant(loaded, dir))) {
      next.add(loaded)
    }
  }
  return next
}

/** Keep the loaded-dir set in step with mutations that delete, replace or move directories. */
export function applyMutationsToLoadedDirs(
  loadedDirs: ReadonlySet<string>,
  mutations: readonly FileExplorerTreeFileMutation[]
): Set<string> {
  let next = new Set(loadedDirs)
  for (const mutation of mutations) {
    if (mutation.kind === 'delete' || (mutation.kind === 'create' && !mutation.isDirectory)) {
      next = withoutLoadedDirsUnder(next, [mutation.relativePath])
    } else if (mutation.kind === 'rename') {
      const moved = [...next].filter((dir) => isSameOrDescendant(dir, mutation.fromRelativePath))
      next = withoutLoadedDirsUnder(next, [mutation.fromRelativePath, mutation.toRelativePath])
      if (mutation.isDirectory) {
        for (const dir of moved) {
          next.add(`${mutation.toRelativePath}${dir.slice(mutation.fromRelativePath.length)}`)
        }
      }
    }
  }
  return next
}

/** Build the cache from a refresh's directory reads, attaching only dirs reachable from the root. */
export function assembleLoadedListing(listings: ReadonlyMap<string, readonly DirEntry[]>): {
  files: string[]
  loadedDirs: Set<string>
} {
  const files: string[] = []
  const loadedDirs = new Set<string>()
  const queue = ['']
  for (let index = 0; index < queue.length; index += 1) {
    const dirRel = queue[index]
    const entries = listings.get(dirRel)
    if (!entries) {
      continue
    }
    loadedDirs.add(dirRel)
    for (const path of dirEntriesToKnownPaths(dirRel, entries)) {
      files.push(path)
      if (path.endsWith('/') && listings.has(path.slice(0, -1))) {
        queue.push(path.slice(0, -1))
      }
    }
  }
  return { files, loadedDirs }
}

/** A scoped tree shows its root's contents unexpanded, so the root and its ancestors count as expanded. */
export function withScopeRootExpanded(
  expandedDirs: ReadonlySet<string>,
  scopePrefix: string
): ReadonlySet<string> {
  if (!scopePrefix) {
    return expandedDirs
  }
  const next = new Set(expandedDirs)
  for (let dir = scopePrefix; dir; dir = getParentRelativeDir(dir)) {
    next.add(dir)
  }
  return next
}

/** Stored expanded dirs whose every ancestor is also expanded, shallowest first. */
export function selectExpandedDirChain(expandedDirs: ReadonlySet<string>): string[] {
  const chain: string[] = []
  for (const dir of expandedDirs) {
    let parent = getParentRelativeDir(dir)
    let reachable = true
    while (parent) {
      if (!expandedDirs.has(parent)) {
        reachable = false
        break
      }
      parent = getParentRelativeDir(parent)
    }
    if (reachable) {
      chain.push(dir)
    }
  }
  return chain.sort((left, right) => left.split('/').length - right.split('/').length)
}

/** Watcher/local mutations applied to the cache, scoped first so unloaded subtrees stay unloaded. */
export function applyMutationsToLoadedListing(
  listing: LoadedListing,
  mutations: readonly FileExplorerTreeFileMutation[]
): LoadedListing & { scoped: FileExplorerTreeFileMutation[] } {
  const scoped = scopeMutationsToLoadedDirs(mutations, (dir) => listing.loadedDirs.has(dir))
  if (scoped.length === 0) {
    return { ...listing, scoped }
  }
  return {
    files: applyTreeFileListMutations(listing.files, scoped),
    loadedDirs: applyMutationsToLoadedDirs(listing.loadedDirs, scoped),
    scoped
  }
}

/** Fold one directory read into the cache; returns null when the directory's own row is gone. */
export function applyDirReadToLoadedListing(
  listing: LoadedListing,
  dirRel: string,
  entries: readonly DirEntry[]
): (LoadedListing & { mutations: FileExplorerTreeFileMutation[]; childPaths: string[] }) | null {
  // Why: the cache only holds children of loaded dirs, so the row implies a loaded parent.
  if (dirRel !== '' && !listing.files.includes(`${dirRel}/`)) {
    return null
  }
  const childPaths = dirEntriesToKnownPaths(dirRel, entries)
  const merge = mergeDirListing(listing.files, dirRel, childPaths)
  const loadedDirs =
    merge.removedDirs.length > 0
      ? withoutLoadedDirsUnder(listing.loadedDirs, merge.removedDirs)
      : new Set(listing.loadedDirs)
  loadedDirs.add(dirRel)
  return { files: merge.files, loadedDirs, mutations: merge.mutations, childPaths }
}

export type WaveReplayEntry =
  | { kind: 'mutations'; mutations: readonly FileExplorerTreeFileMutation[] }
  | { kind: 'dir'; dirRel: string; entries: readonly DirEntry[] }

export function replayWaveEntry(listing: LoadedListing, entry: WaveReplayEntry): LoadedListing {
  if (entry.kind === 'mutations') {
    const { files, loadedDirs } = applyMutationsToLoadedListing(listing, entry.mutations)
    return { files, loadedDirs }
  }
  const applied = applyDirReadToLoadedListing(listing, entry.dirRel, entry.entries)
  return applied ? { files: applied.files, loadedDirs: applied.loadedDirs } : listing
}

function byDepth(left: string, right: string): number {
  return left.split('/').length - right.split('/').length
}

/** Fold several reads shallowest-first so a child lands after its parent's row exists. */
export function applyDirReadsToLoadedListing(
  listing: LoadedListing,
  listings: ReadonlyMap<string, readonly DirEntry[]>
): {
  listing: LoadedListing
  mutations: FileExplorerTreeFileMutation[]
  replayEntries: WaveReplayEntry[]
  unattachedDirs: string[]
} {
  let next = listing
  const mutations: FileExplorerTreeFileMutation[] = []
  const replayEntries: WaveReplayEntry[] = []
  const unattachedDirs: string[] = []
  for (const dirRel of [...listings.keys()].sort(byDepth)) {
    const entries = listings.get(dirRel) ?? []
    const applied = applyDirReadToLoadedListing(next, dirRel, entries)
    if (!applied) {
      unattachedDirs.push(dirRel)
      continue
    }
    next = { files: applied.files, loadedDirs: applied.loadedDirs }
    mutations.push(...applied.mutations)
    replayEntries.push({ kind: 'dir', dirRel, entries })
  }
  return { listing: next, mutations, replayEntries, unattachedDirs }
}

/** Expanded folders to list now; a child waits until its parent is loaded or listed alongside it. */
export function selectDirsToAutoLoad(
  expandedDirs: ReadonlySet<string>,
  loadedDirs: ReadonlySet<string>,
  isBlocked: (relativeDir: string) => boolean
): string[] {
  const candidates = selectExpandedDirChain(expandedDirs).filter(
    (dir) => !loadedDirs.has(dir) && !isBlocked(dir)
  )
  const candidateSet = new Set(candidates)
  return candidates.filter((dir) => {
    const parent = getParentRelativeDir(dir)
    return loadedDirs.has(parent) || candidateSet.has(parent)
  })
}

/** Replace the answers for `checkedPaths` in a relative ignored set (folder rows lose their slash). */
export function mergeIgnoredPaths(
  current: ReadonlySet<string>,
  checkedPaths: readonly string[],
  ignoredPaths: readonly string[]
): Set<string> {
  const next = new Set(current)
  for (const path of checkedPaths) {
    next.delete(path.endsWith('/') ? path.slice(0, -1) : path)
  }
  for (const path of buildIgnoredSet(ignoredPaths)) {
    next.add(path)
  }
  return next
}
