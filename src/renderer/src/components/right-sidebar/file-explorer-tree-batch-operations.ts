import type { FileTreeBatchOperation } from '@pierre/trees'
import type { FileExplorerTreeFileMutation } from './file-explorer-tree-watch-mutations'

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
  const virtualPaths = new Map<string, boolean | null>()
  const removedPrefixes = new Set<string>()
  const movedDirectoryDestinations: string[] = []
  const lookup = (path: string): boolean | null => {
    const known = virtualPaths.get(path)
    if (known !== undefined) {
      return known
    }
    for (const prefix of removedPrefixes) {
      if (path === prefix || path.startsWith(`${prefix}/`)) {
        return null
      }
    }
    return model.getItem(path)?.isDirectory() ?? null
  }
  const markRemoved = (path: string): void => {
    removedPrefixes.add(path)
    for (const knownPath of virtualPaths.keys()) {
      if (knownPath === path || knownPath.startsWith(`${path}/`)) {
        virtualPaths.set(knownPath, null)
      }
    }
    virtualPaths.set(path, null)
  }
  const markAdded = (path: string, isDirectory: boolean): void => {
    virtualPaths.set(path, isDirectory)
    for (let slashIndex = path.lastIndexOf('/'); slashIndex !== -1;) {
      const parent = path.slice(0, slashIndex)
      virtualPaths.set(parent, true)
      slashIndex = parent.lastIndexOf('/')
    }
  }

  for (const mutation of mutations) {
    let touchesMovedDirectory = false
    for (const directory of movedDirectoryDestinations) {
      if (
        (mutation.kind === 'rename' &&
          (mutation.fromRelativePath.startsWith(`${directory}/`) ||
            mutation.toRelativePath.startsWith(`${directory}/`))) ||
        (mutation.kind !== 'rename' && mutation.relativePath.startsWith(`${directory}/`))
      ) {
        touchesMovedDirectory = true
        break
      }
    }
    if (touchesMovedDirectory) {
      // Why: the pre-batch model cannot inspect descendants that an earlier
      // directory move will create.
      return null
    }

    if (mutation.kind === 'create') {
      let parent = mutation.relativePath
      let ancestorFile: string | null = null
      while (parent.includes('/')) {
        parent = parent.slice(0, parent.lastIndexOf('/'))
        if (lookup(parent) === false) {
          ancestorFile = parent
          break
        }
      }
      if (ancestorFile) {
        ops.push({ type: 'remove', path: ancestorFile, recursive: true })
        markRemoved(ancestorFile)
      }

      const existingKind = lookup(mutation.relativePath)
      if (existingKind !== null && existingKind !== mutation.isDirectory) {
        ops.push({
          type: 'remove',
          path: existingKind ? `${mutation.relativePath}/` : mutation.relativePath,
          recursive: true
        })
        markRemoved(mutation.relativePath)
      }
      const shouldAdd =
        passesFilter(mutation.relativePath) &&
        (existingKind === null || existingKind !== mutation.isDirectory)
      if (shouldAdd) {
        ops.push({
          type: 'add',
          path: mutation.isDirectory ? `${mutation.relativePath}/` : mutation.relativePath
        })
        markAdded(mutation.relativePath, mutation.isDirectory)
      }
    } else if (mutation.kind === 'delete') {
      const existingKind = lookup(mutation.relativePath)
      if (existingKind !== null) {
        ops.push({
          type: 'remove',
          path: existingKind ? `${mutation.relativePath}/` : mutation.relativePath,
          recursive: true
        })
      }
      markRemoved(mutation.relativePath)
    } else {
      const fromKind = lookup(mutation.fromRelativePath)
      if (fromKind !== null && fromKind !== mutation.isDirectory) {
        return null
      }
      if (fromKind === null) {
        if (mutation.isDirectory) {
          // Why: the moved directory's children are unknown to the model; relist.
          return null
        }
        const destinationKind = lookup(mutation.toRelativePath)
        if (passesFilter(mutation.toRelativePath) && destinationKind !== false) {
          if (destinationKind === true) {
            ops.push({ type: 'remove', path: `${mutation.toRelativePath}/`, recursive: true })
            markRemoved(mutation.toRelativePath)
          }
          ops.push({ type: 'add', path: mutation.toRelativePath })
          markAdded(mutation.toRelativePath, false)
        }
      } else {
        const fromPath = fromKind ? `${mutation.fromRelativePath}/` : mutation.fromRelativePath
        if (lookup(mutation.toRelativePath) === true) {
          markRemoved(mutation.toRelativePath)
        }
        if (passesFilter(mutation.toRelativePath)) {
          ops.push({
            type: 'move',
            from: fromPath,
            to: fromKind ? `${mutation.toRelativePath}/` : mutation.toRelativePath,
            collision: 'replace'
          })
          markAdded(mutation.toRelativePath, fromKind)
          if (fromKind) {
            movedDirectoryDestinations.push(mutation.toRelativePath)
          }
        } else {
          ops.push({ type: 'remove', path: fromPath, recursive: true })
        }
        markRemoved(mutation.fromRelativePath)
      }
    }
  }
  return ops
}
