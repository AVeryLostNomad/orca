import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import type { FileTreeModelLike } from './use-file-explorer-tree-model'
import {
  normalizeTreeRelativePath,
  toAbsoluteDirSet,
  toWorktreeRelativeDirSet
} from './file-explorer-tree-relative-paths'

export type FileTreeExpansionSnapshot = {
  visibleExpanded: ReadonlySet<string>
  visibleCollapsed: ReadonlySet<string>
}

/** Scan the model's visible rows for directory expansion state (relative paths). */
export function readFileTreeExpansionSnapshot(model: FileTreeModelLike): FileTreeExpansionSnapshot {
  const visibleExpanded = new Set<string>()
  const visibleCollapsed = new Set<string>()
  for (const row of model.getVisibleRows(0, model.getVisibleCount())) {
    if (row.kind !== 'directory') {
      continue
    }
    const path = normalizeTreeRelativePath(row.path)
    if (row.isExpanded) {
      visibleExpanded.add(path)
    } else {
      visibleCollapsed.add(path)
    }
  }
  return { visibleExpanded, visibleCollapsed }
}

/**
 * Next persisted expanded-dir set: everything visibly expanded, plus stored
 * dirs currently hidden under a collapsed ancestor (so nested expansion
 * survives collapsing and re-expanding a parent). Visibly collapsed stored
 * dirs are dropped.
 */
export function diffExpandedDirPaths(
  snapshot: FileTreeExpansionSnapshot,
  storedRelativeDirs: ReadonlySet<string>
): Set<string> {
  const next = new Set(snapshot.visibleExpanded)
  for (const dir of storedRelativeDirs) {
    if (!snapshot.visibleCollapsed.has(dir)) {
      next.add(dir)
    }
  }
  return next
}

function areSetsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false
    }
  }
  return true
}

type UseFileTreeExpansionSyncParams = {
  model: FileTreeModelLike | null
  activeWorktreeId: string | null
  worktreePath: string | null
  /** True while the name filter drives model search; its auto-expansion is ephemeral. */
  suspended: boolean
}

/** Persists the tree's expansion state into the store's expandedDirs (absolute paths). */
export function useFileTreeExpansionSync({
  model,
  activeWorktreeId,
  worktreePath,
  suspended
}: UseFileTreeExpansionSyncParams): void {
  const suspendedRef = useRef(suspended)
  suspendedRef.current = suspended

  useEffect(() => {
    if (!model || !activeWorktreeId || !worktreePath) {
      return
    }
    let frame: number | null = null
    const sync = (): void => {
      frame = null
      if (suspendedRef.current) {
        return
      }
      const state = useAppStore.getState()
      const storedAbsolute = state.expandedDirs[activeWorktreeId] ?? new Set<string>()
      const storedRelative = toWorktreeRelativeDirSet(storedAbsolute, worktreePath)
      const next = diffExpandedDirPaths(readFileTreeExpansionSnapshot(model), storedRelative)
      if (!areSetsEqual(next, storedRelative)) {
        state.setExpandedDirs(activeWorktreeId, toAbsoluteDirSet(next, worktreePath))
      }
    }
    const unsubscribe = model.subscribe(() => {
      // Why: one write per frame — a click can emit several model events.
      if (frame === null) {
        frame = requestAnimationFrame(sync)
      }
    })
    return () => {
      unsubscribe()
      if (frame !== null) {
        cancelAnimationFrame(frame)
      }
    }
  }, [model, activeWorktreeId, worktreePath])
}
