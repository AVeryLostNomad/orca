import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileTreeRenameEvent, FileTreeRenamingItem } from '@pierre/trees'
import { getRelativePathInsideRoot, joinPath } from '@/lib/path'
import { createExplorerEntryOnDisk } from './file-explorer-create-entry'
import { getCreatePlaceholderRelativePath } from './file-explorer-create-placeholder'
import { normalizeTreeRelativePath } from './file-explorer-tree-relative-paths'
import type { FileExplorerTreeFileMutation } from './file-explorer-tree-watch-mutations'
import type { FileExplorerOperationOwner } from './file-explorer-types'
import type { FileTreeModelLike } from './use-file-explorer-tree-model'

type PendingCreate = {
  kind: 'file' | 'folder'
  placeholderRelativePath: string
  /** The rename input rendered at least once; only then can silence mean "committed unchanged". */
  inputSeen: boolean
}

type UseFileTreeCreateParams = {
  model: FileTreeModelLike | null
  activeWorktreeId: string | null
  worktreePath: string | null
  operationOwner: FileExplorerOperationOwner | undefined
  refreshFileList: () => void
  applyExternalFileMutations: (mutations: readonly FileExplorerTreeFileMutation[]) => void
}

export type FileTreeCreateApi = {
  /** Add a placeholder in parentAbsoluteDir and hand it to the tree's inline rename. */
  startNew: (kind: 'file' | 'folder', parentAbsoluteDir: string) => void
  /** True while a create placeholder is being named. */
  isCreatePending: boolean
  /** Rejects renames of other rows while a create placeholder is pending. */
  canRename: (item: FileTreeRenamingItem) => boolean
  /** Returns true when the rename commit belonged to a create placeholder. */
  handleRenameCommit: (event: FileTreeRenameEvent) => boolean
}

/** Detect the tree's inline rename editor through the host's open shadow root. */
export function isFileTreeRenameInputActive(model: FileTreeModelLike | null): boolean {
  const container = model?.getFileTreeContainer()
  return Boolean(container?.shadowRoot?.querySelector('input[data-item-rename-input]'))
}

/**
 * Create-via-rename: add a collision-free placeholder, start the library's
 * inline rename with removeIfCanceled, and create the entry on disk when the
 * rename commits (including a commit that keeps the placeholder name).
 */
export function useFileTreeCreate({
  model,
  activeWorktreeId,
  worktreePath,
  operationOwner,
  refreshFileList,
  applyExternalFileMutations
}: UseFileTreeCreateParams): FileTreeCreateApi {
  const [pending, setPending] = useState<PendingCreate | null>(null)
  const pendingRef = useRef(pending)
  pendingRef.current = pending

  const commitCreate = useCallback(
    (kind: 'file' | 'folder', destinationRelativePath: string) => {
      if (!activeWorktreeId || !worktreePath || !model) {
        return
      }
      const relative = normalizeTreeRelativePath(destinationRelativePath)
      void (async () => {
        const created = await createExplorerEntryOnDisk({
          worktreeId: activeWorktreeId,
          worktreePath,
          fullPath: joinPath(worktreePath, relative),
          relativePath: relative,
          kind,
          operationOwner,
          refresh: refreshFileList
        })
        if (created) {
          // Why: the model already holds the committed entry; this records it
          // in the flat cache so filter-driven resets keep it alive.
          applyExternalFileMutations([
            { kind: 'create', relativePath: relative, isDirectory: kind === 'folder' }
          ])
        } else {
          const canonical = kind === 'folder' ? `${relative}/` : relative
          if (model.getItem(relative)) {
            try {
              model.remove(canonical, { recursive: true })
            } catch {
              refreshFileList()
            }
          }
        }
      })()
    },
    [
      activeWorktreeId,
      applyExternalFileMutations,
      model,
      operationOwner,
      refreshFileList,
      worktreePath
    ]
  )

  const startNew = useCallback(
    (kind: 'file' | 'folder', parentAbsoluteDir: string) => {
      if (!model || !worktreePath || pendingRef.current) {
        return
      }
      const parentRelative = normalizeTreeRelativePath(
        getRelativePathInsideRoot(parentAbsoluteDir, worktreePath) ?? ''
      )
      const placeholder = getCreatePlaceholderRelativePath(parentRelative, (candidate) =>
        Boolean(model.getItem(candidate))
      )
      if (!placeholder) {
        return
      }
      const canonical = kind === 'folder' ? `${placeholder}/` : placeholder
      try {
        model.add(canonical)
      } catch {
        return
      }
      if (model.startRenaming(canonical, { removeIfCanceled: true })) {
        setPending({ kind, placeholderRelativePath: placeholder, inputSeen: false })
      } else {
        try {
          model.remove(canonical, { recursive: true })
        } catch {
          refreshFileList()
        }
      }
    },
    [model, refreshFileList, worktreePath]
  )

  const canRename = useCallback((item: FileTreeRenamingItem): boolean => {
    const current = pendingRef.current
    if (!current) {
      return true
    }
    return normalizeTreeRelativePath(item.path) === current.placeholderRelativePath
  }, [])

  const handleRenameCommit = useCallback(
    (event: FileTreeRenameEvent): boolean => {
      const current = pendingRef.current
      if (
        !current ||
        normalizeTreeRelativePath(event.sourcePath) !== current.placeholderRelativePath
      ) {
        return false
      }
      setPending(null)
      pendingRef.current = null
      commitCreate(current.kind, event.destinationPath)
      return true
    },
    [commitCreate]
  )

  // Why: committing the placeholder without editing its name fires no rename
  // event and no mutation; detect the rename editor unmounting instead.
  useEffect(() => {
    if (!model || !pending) {
      return
    }
    let frame: number | null = null
    const check = (): void => {
      frame = null
      const current = pendingRef.current
      if (!current) {
        return
      }
      if (isFileTreeRenameInputActive(model)) {
        if (!current.inputSeen) {
          current.inputSeen = true
        }
        return
      }
      if (!current.inputSeen) {
        return
      }
      setPending(null)
      pendingRef.current = null
      if (model.getItem(current.placeholderRelativePath)) {
        commitCreate(current.kind, current.placeholderRelativePath)
      }
      // Why: a missing placeholder means the rename canceled and the library
      // already removed it (removeIfCanceled) — nothing to clean up.
    }
    const unsubscribe = model.subscribe(() => {
      if (frame === null) {
        frame = requestAnimationFrame(check)
      }
    })
    // Why: cover ends that emit no model event (blur commit with no change).
    const interval = window.setInterval(check, 300)
    return () => {
      unsubscribe()
      window.clearInterval(interval)
      if (frame !== null) {
        cancelAnimationFrame(frame)
      }
    }
  }, [commitCreate, model, pending])

  return { startNew, isCreatePending: pending !== null, canRename, handleRenameCommit }
}
