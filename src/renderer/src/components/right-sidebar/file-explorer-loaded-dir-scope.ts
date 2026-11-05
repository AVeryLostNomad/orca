import type { FsChangedPayload, FsChangeEvent } from '../../../../shared/filesystem-entry-types'
import { relativePathInsideRoot } from '../../../../shared/cross-platform-path'
import { joinPath, normalizeRelativePath } from '@/lib/path'
import type { FileExplorerTreeFileMutation } from './file-explorer-tree-watch-mutations'

/** Worktree-relative parent dir; '' is the worktree root. */
export function getParentRelativeDir(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/')
  return slash === -1 ? '' : relativePath.slice(0, slash)
}

/** The path itself when its parent is loaded, else its shallowest unloaded ancestor (the row that stands for it). */
export function visibleAncestorEntry(
  relativePath: string,
  isDirLoaded: (relativeDir: string) => boolean
): string | null {
  if (!relativePath || !isDirLoaded('')) {
    return null
  }
  let current = ''
  for (const segment of relativePath.split('/')) {
    current = current ? `${current}/${segment}` : segment
    if (current === relativePath || !isDirLoaded(current)) {
      return current
    }
  }
  return null
}

/**
 * Drop mutations inside unloaded directories; a change deep inside one becomes
 * a create of the directory row that represents it (a no-op when it exists).
 */
export function scopeMutationsToLoadedDirs(
  mutations: readonly FileExplorerTreeFileMutation[],
  isDirLoaded: (relativeDir: string) => boolean
): FileExplorerTreeFileMutation[] {
  const scoped: FileExplorerTreeFileMutation[] = []
  const synthesizedDirs = new Set<string>()
  const addCreate = (relativePath: string, isDirectory: boolean): void => {
    const visible = visibleAncestorEntry(relativePath, isDirLoaded)
    if (visible === relativePath) {
      scoped.push({ kind: 'create', relativePath, isDirectory })
    } else if (visible !== null && !synthesizedDirs.has(visible)) {
      synthesizedDirs.add(visible)
      scoped.push({ kind: 'create', relativePath: visible, isDirectory: true })
    }
  }
  for (const mutation of mutations) {
    if (mutation.kind === 'create') {
      addCreate(mutation.relativePath, mutation.isDirectory)
    } else if (mutation.kind === 'delete') {
      if (isDirLoaded(getParentRelativeDir(mutation.relativePath))) {
        scoped.push(mutation)
      }
    } else {
      const fromVisible = isDirLoaded(getParentRelativeDir(mutation.fromRelativePath))
      const toVisible = isDirLoaded(getParentRelativeDir(mutation.toRelativePath))
      if (fromVisible && toVisible) {
        scoped.push(mutation)
        continue
      }
      if (fromVisible) {
        scoped.push({
          kind: 'delete',
          relativePath: mutation.fromRelativePath,
          isDirectory: mutation.isDirectory
        })
      }
      addCreate(mutation.toRelativePath, mutation.isDirectory)
    }
  }
  return scoped
}

function toRelative(worktreePath: string, absolutePath: string): string | null {
  const relative = relativePathInsideRoot(worktreePath, absolutePath)
  return relative ? normalizeRelativePath(relative).replace(/\/+$/, '') : null
}

/**
 * Event-level counterpart of scopeMutationsToLoadedDirs, applied before kind
 * inference so churn inside unloaded folders never forces a relist.
 */
export function scopeFsEventsToLoadedDirs(
  payload: FsChangedPayload,
  worktreePath: string,
  isDirLoaded: (relativeDir: string) => boolean
): FsChangedPayload {
  const events: FsChangeEvent[] = []
  const synthesizedDirs = new Set<string>()
  const pushVisibleAncestor = (relativePath: string): void => {
    const visible = visibleAncestorEntry(relativePath, isDirLoaded)
    if (visible !== null && visible !== relativePath && !synthesizedDirs.has(visible)) {
      synthesizedDirs.add(visible)
      events.push({
        kind: 'create',
        absolutePath: joinPath(worktreePath, visible),
        isDirectory: true
      })
    }
  }
  for (const event of payload.events) {
    const relativePath =
      event.kind === 'overflow' ? null : toRelative(worktreePath, event.absolutePath)
    if (relativePath === null) {
      events.push(event)
      continue
    }
    const visible = isDirLoaded(getParentRelativeDir(relativePath))
    if (event.kind === 'rename') {
      const fromRelative = event.oldAbsolutePath
        ? toRelative(worktreePath, event.oldAbsolutePath)
        : null
      const fromVisible = fromRelative !== null && isDirLoaded(getParentRelativeDir(fromRelative))
      if (visible && (fromVisible || fromRelative === null)) {
        events.push(event)
      } else if (visible) {
        events.push({
          kind: 'create',
          absolutePath: event.absolutePath,
          ...(event.isDirectory === undefined ? {} : { isDirectory: event.isDirectory })
        })
      } else {
        if (fromVisible && event.oldAbsolutePath) {
          events.push({ kind: 'delete', absolutePath: event.oldAbsolutePath })
        }
        pushVisibleAncestor(relativePath)
      }
    } else if (visible) {
      events.push(event)
    } else if (event.kind !== 'delete') {
      pushVisibleAncestor(relativePath)
    }
  }
  return events.length === payload.events.length &&
    events.every((event, index) => event === payload.events[index])
    ? payload
    : { ...payload, events }
}
