import type { FsChangedPayload } from '../../../../shared/filesystem-entry-types'
import {
  normalizeRuntimePathForComparison,
  relativePathInsideRoot
} from '../../../../shared/cross-platform-path'
import { normalizeRelativePath } from '@/lib/path'

/** Flat-list mutation derived from a watcher event; directory paths never carry a trailing slash here. */
export type FileExplorerTreeFileMutation =
  | { kind: 'create'; relativePath: string; isDirectory: boolean }
  | { kind: 'delete'; relativePath: string; isDirectory: boolean }
  | { kind: 'rename'; fromRelativePath: string; toRelativePath: string; isDirectory: boolean }

export type MapFsEventsResult = {
  mutations: FileExplorerTreeFileMutation[]
  /** Overflow or an event the flat cache cannot reconcile locally. */
  needsFullRelist: boolean
}

function toWatchRelativePath(worktreePath: string, absolutePath: string): string | null {
  const relative = relativePathInsideRoot(worktreePath, absolutePath)
  if (relative === null || relative === '') {
    return null
  }
  return normalizeRelativePath(relative).replace(/\/+$/, '')
}

function hasKnownDirectoryEntries(files: readonly string[], relativePath: string): boolean {
  const dirPrefix = `${relativePath}/`
  return files.some((file) => file === dirPrefix || file.startsWith(dirPrefix))
}

function knownPathKind(files: readonly string[], relativePath: string): boolean | null {
  if (hasKnownDirectoryEntries(files, relativePath)) {
    return true
  }
  return files.includes(relativePath) ? false : null
}

/**
 * Map a watcher payload into flat-list mutations for the @pierre/trees pane.
 *
 * Why pure: the watcher-vs-model reconciliation is the failure-prone part of
 * explorer refreshes, so the mapping stays unit-testable without a model.
 */
export function mapFsEventsToTreeFileMutations({
  payload,
  worktreePath,
  files
}: {
  payload: FsChangedPayload
  worktreePath: string
  files: readonly string[]
}): MapFsEventsResult {
  if (
    normalizeRuntimePathForComparison(payload.worktreePath) !==
    normalizeRuntimePathForComparison(worktreePath)
  ) {
    return { mutations: [], needsFullRelist: false }
  }

  const mutations: FileExplorerTreeFileMutation[] = []
  let knownFiles = files
  for (const evt of payload.events) {
    if (evt.kind === 'overflow') {
      return { mutations: [], needsFullRelist: true }
    }
    const relativePath = toWatchRelativePath(worktreePath, evt.absolutePath)
    if (!relativePath) {
      continue
    }
    if (evt.kind === 'delete') {
      // Why: watchers cannot report isDirectory for deletes; infer from the flat cache.
      const mutation: FileExplorerTreeFileMutation = {
        kind: 'delete',
        relativePath,
        isDirectory: hasKnownDirectoryEntries(knownFiles, relativePath)
      }
      mutations.push(mutation)
      knownFiles = applyTreeFileListMutations(knownFiles, [mutation])
      continue
    }

    const eventKind =
      typeof evt.isDirectory === 'boolean'
        ? evt.isDirectory
        : knownPathKind(knownFiles, relativePath)
    if (evt.kind === 'create') {
      const createKind =
        typeof evt.isDirectory === 'boolean'
          ? evt.isDirectory
          : hasKnownDirectoryEntries(knownFiles, relativePath)
            ? true
            : null
      if (createKind === null) {
        return { mutations: [], needsFullRelist: true }
      }
      const mutation: FileExplorerTreeFileMutation = {
        kind: 'create',
        relativePath,
        isDirectory: createKind
      }
      mutations.push(mutation)
      knownFiles = applyTreeFileListMutations(knownFiles, [mutation])
    } else if (evt.kind === 'rename') {
      const fromRelativePath = evt.oldAbsolutePath
        ? toWatchRelativePath(worktreePath, evt.oldAbsolutePath)
        : null
      const sourceKind = fromRelativePath ? knownPathKind(knownFiles, fromRelativePath) : null
      const isDirectory = typeof evt.isDirectory === 'boolean' ? evt.isDirectory : sourceKind
      if (isDirectory === null) {
        return { mutations: [], needsFullRelist: true }
      }
      const mutation: FileExplorerTreeFileMutation = fromRelativePath
        ? { kind: 'rename', fromRelativePath, toRelativePath: relativePath, isDirectory }
        : { kind: 'create', relativePath, isDirectory }
      mutations.push(mutation)
      knownFiles = applyTreeFileListMutations(knownFiles, [mutation])
    } else if (knownPathKind(knownFiles, relativePath) === null) {
      // Windows can classify a new entry as update. Without authoritative
      // metadata, a directory here would poison the flat cache as a file.
      if (eventKind === null) {
        return { mutations: [], needsFullRelist: true }
      }
      const mutation: FileExplorerTreeFileMutation = {
        kind: 'create',
        relativePath,
        isDirectory: eventKind
      }
      mutations.push(mutation)
      knownFiles = applyTreeFileListMutations(knownFiles, [mutation])
    } else if (eventKind !== null && eventKind !== knownPathKind(knownFiles, relativePath)) {
      const mutation: FileExplorerTreeFileMutation = {
        kind: 'create',
        relativePath,
        isDirectory: eventKind
      }
      mutations.push(mutation)
      knownFiles = applyTreeFileListMutations(knownFiles, [mutation])
    }
  }
  return { mutations, needsFullRelist: false }
}

/**
 * Apply watcher mutations to the flat runtime file list. Directory entries are
 * stored with a trailing slash so empty folders survive the next tree reset.
 */
export function applyTreeFileListMutations(
  files: readonly string[],
  mutations: readonly FileExplorerTreeFileMutation[]
): string[] {
  let next = [...files]
  for (const mutation of mutations) {
    if (mutation.kind === 'create') {
      for (let slashIndex = mutation.relativePath.lastIndexOf('/'); slashIndex !== -1;) {
        const ancestor = mutation.relativePath.slice(0, slashIndex)
        next = next.filter((file) => file !== ancestor)
        slashIndex = ancestor.lastIndexOf('/')
      }

      const directoryEntry = `${mutation.relativePath}/`
      if (mutation.isDirectory) {
        next = next.filter((file) => file !== mutation.relativePath)
        if (!next.includes(directoryEntry)) {
          next.push(directoryEntry)
        }
      } else {
        const hasOnlyFile =
          next.includes(mutation.relativePath) &&
          !next.some((file) => file.startsWith(directoryEntry))
        if (!hasOnlyFile) {
          next = next.filter(
            (file) => file !== mutation.relativePath && !file.startsWith(directoryEntry)
          )
          next.push(mutation.relativePath)
        }
      }
    } else if (mutation.kind === 'delete') {
      const dirPrefix = `${mutation.relativePath}/`
      next = next.filter(
        (file) =>
          file !== mutation.relativePath && file !== dirPrefix && !file.startsWith(dirPrefix)
      )
    } else {
      const fromDirPrefix = `${mutation.fromRelativePath}/`
      const toDirPrefix = `${mutation.toRelativePath}/`
      const sourceEntries = next.filter(
        (file) =>
          file === mutation.fromRelativePath ||
          file === fromDirPrefix ||
          file.startsWith(fromDirPrefix)
      )
      next = next.filter(
        (file) =>
          file !== mutation.fromRelativePath &&
          !file.startsWith(fromDirPrefix) &&
          file !== mutation.toRelativePath &&
          !file.startsWith(toDirPrefix)
      )
      for (let slashIndex = mutation.toRelativePath.lastIndexOf('/'); slashIndex !== -1;) {
        const ancestor = mutation.toRelativePath.slice(0, slashIndex)
        next = next.filter((file) => file !== ancestor)
        slashIndex = ancestor.lastIndexOf('/')
      }

      const seen = new Set(next)
      for (const file of sourceEntries) {
        let mapped: string | null = null
        if (mutation.isDirectory) {
          if (file === mutation.fromRelativePath || file === fromDirPrefix) {
            mapped = toDirPrefix
          } else if (file.startsWith(fromDirPrefix)) {
            mapped = `${toDirPrefix}${file.slice(fromDirPrefix.length)}`
          }
        } else if (file === mutation.fromRelativePath) {
          mapped = mutation.toRelativePath
        }
        if (mapped && !seen.has(mapped)) {
          seen.add(mapped)
          next.push(mapped)
        }
      }
      if (sourceEntries.length === 0) {
        const entry = mutation.isDirectory ? toDirPrefix : mutation.toRelativePath
        if (!seen.has(entry)) {
          next.push(entry)
        }
      }
    }
  }
  return next
}
