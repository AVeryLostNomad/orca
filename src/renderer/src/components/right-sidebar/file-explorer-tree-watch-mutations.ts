import type { FileTreeBatchOperation } from '@pierre/trees'
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

function hasKnownPath(files: readonly string[], relativePath: string): boolean {
  return files.includes(relativePath) || hasKnownDirectoryEntries(files, relativePath)
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
  for (const evt of payload.events) {
    if (evt.kind === 'overflow') {
      return { mutations: [], needsFullRelist: true }
    }
    const relativePath = toWatchRelativePath(worktreePath, evt.absolutePath)
    if (!relativePath) {
      continue
    }
    if (evt.kind === 'create') {
      mutations.push({ kind: 'create', relativePath, isDirectory: evt.isDirectory === true })
    } else if (evt.kind === 'delete') {
      // Why: watchers cannot report isDirectory for deletes; infer from the flat cache.
      mutations.push({
        kind: 'delete',
        relativePath,
        isDirectory: hasKnownDirectoryEntries(files, relativePath)
      })
    } else if (evt.kind === 'rename') {
      const fromRelativePath = evt.oldAbsolutePath
        ? toWatchRelativePath(worktreePath, evt.oldAbsolutePath)
        : null
      if (!fromRelativePath) {
        // Why: a rename into the worktree from outside is a create here.
        mutations.push({ kind: 'create', relativePath, isDirectory: evt.isDirectory === true })
        continue
      }
      mutations.push({
        kind: 'rename',
        fromRelativePath,
        toRelativePath: relativePath,
        isDirectory: evt.isDirectory === true || hasKnownDirectoryEntries(files, fromRelativePath)
      })
    } else if (evt.kind === 'update') {
      // Windows can classify a new file as update; known-path updates don't change the tree.
      if (evt.isDirectory !== true && !hasKnownPath(files, relativePath)) {
        mutations.push({ kind: 'create', relativePath, isDirectory: false })
      }
    }
  }
  return { mutations, needsFullRelist: false }
}

/** Minimal model probe so op-building stays testable without a real tree. */
export type TreeMutationModelProbe = {
  getItem(path: string): { isDirectory(): boolean } | null
}

/**
 * Translate flat-list mutations into guarded @pierre/trees batch operations.
 * Returns null when the model cannot reconcile locally (escalate to a relist).
 */
export function buildTreeModelBatchOps(
  model: TreeMutationModelProbe,
  mutations: readonly FileExplorerTreeFileMutation[],
  passesFilter: (relativePath: string) => boolean
): FileTreeBatchOperation[] | null {
  const ops: FileTreeBatchOperation[] = []
  for (const mutation of mutations) {
    if (mutation.kind === 'create') {
      if (!passesFilter(mutation.relativePath) || model.getItem(mutation.relativePath)) {
        continue
      }
      ops.push({
        type: 'add',
        path: mutation.isDirectory ? `${mutation.relativePath}/` : mutation.relativePath
      })
    } else if (mutation.kind === 'delete') {
      const item = model.getItem(mutation.relativePath)
      if (!item) {
        continue
      }
      ops.push({
        type: 'remove',
        path: item.isDirectory() ? `${mutation.relativePath}/` : mutation.relativePath,
        recursive: true
      })
    } else {
      const fromItem = model.getItem(mutation.fromRelativePath)
      const destItem = model.getItem(mutation.toRelativePath)
      if (!fromItem) {
        if (destItem) {
          continue
        }
        if (!passesFilter(mutation.toRelativePath)) {
          continue
        }
        if (mutation.isDirectory) {
          // Why: the moved directory's children are unknown to the model; relist.
          return null
        }
        ops.push({ type: 'add', path: mutation.toRelativePath })
        continue
      }
      const isDirectory = fromItem.isDirectory()
      const fromCanonical = isDirectory
        ? `${mutation.fromRelativePath}/`
        : mutation.fromRelativePath
      if (!passesFilter(mutation.toRelativePath) || destItem) {
        ops.push({ type: 'remove', path: fromCanonical, recursive: true })
        continue
      }
      ops.push({
        type: 'move',
        from: fromCanonical,
        to: isDirectory ? `${mutation.toRelativePath}/` : mutation.toRelativePath,
        collision: 'replace'
      })
    }
  }
  return ops
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
      const entry = mutation.isDirectory ? `${mutation.relativePath}/` : mutation.relativePath
      if (!next.includes(entry)) {
        next.push(entry)
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
      const seen = new Set<string>()
      const renamed: string[] = []
      for (const file of next) {
        let mapped = file
        if (file === mutation.fromRelativePath) {
          mapped = mutation.isDirectory ? toDirPrefix : mutation.toRelativePath
        } else if (file === fromDirPrefix) {
          mapped = toDirPrefix
        } else if (file.startsWith(fromDirPrefix)) {
          mapped = `${toDirPrefix}${file.slice(fromDirPrefix.length)}`
        }
        if (!seen.has(mapped)) {
          seen.add(mapped)
          renamed.push(mapped)
        }
      }
      next = renamed
    }
  }
  return next
}
