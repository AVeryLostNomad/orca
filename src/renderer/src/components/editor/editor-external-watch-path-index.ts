import { joinPath } from '@/lib/path'
import { getExternalFileChangeRelativePath } from '@/components/right-sidebar/file-explorer-watch-path'
import type { WorkingDocument, WorkingDocumentId } from '@/store/slices/editor/working-document'
import type { FsChangedPayload } from '../../../../shared/filesystem-entry-types'
import {
  getLocalWindowsWslPathIdentity,
  normalizeRuntimePathForComparison,
  type LocalWindowsWslPathIdentity
} from '../../../../shared/cross-platform-path'

type WatchScope = {
  worktreeId: string
  worktreePath: string
  runtimeEnvironmentId: string | null
  allowLocalWindowsWslAliases?: true
}

type IndexedPath = {
  absolutePath: string
  identity: LocalWindowsWslPathIdentity
}

export type IndexedExternalWatchChange = IndexedPath & {
  relativePath: string
}

export type EditorExternalWatchBatchPathIndex = {
  createOrUpdatePaths: ReadonlyMap<string, string>
  changes: readonly IndexedExternalWatchChange[]
  deletedWorkingDocuments: readonly {
    documentId: WorkingDocumentId
    normalizedDeletePath: string
  }[]
  matchingDocumentIds: (change: IndexedExternalWatchChange) => WorkingDocumentId[]
  matchesCreateOrUpdate: (document: WorkingDocument) => boolean
}

function pathIdentity(value: string, allowAliases: boolean): LocalWindowsWslPathIdentity {
  if (allowAliases) {
    return getLocalWindowsWslPathIdentity(value)
  }
  const normalizedPath = normalizeRuntimePathForComparison(value)
  return { normalizedPath, aliasComparisonPath: normalizedPath, isWslUnc: false }
}

function pathsMatch(
  left: LocalWindowsWslPathIdentity,
  right: LocalWindowsWslPathIdentity,
  allowAliases: boolean
): boolean {
  return (
    left.normalizedPath === right.normalizedPath ||
    (allowAliases &&
      left.aliasComparisonPath === right.aliasComparisonPath &&
      (left.isWslUnc || right.isWslUnc))
  )
}

export function indexEditorExternalWatchBatchPaths(
  payload: FsChangedPayload,
  workingDocuments: Record<WorkingDocumentId, WorkingDocument>,
  scope: WatchScope
): EditorExternalWatchBatchPathIndex {
  const allowAliases = scope.allowLocalWindowsWslAliases === true
  const createOrUpdatePaths = new Map<string, string>()
  const changesByRelativePath = new Map<string, IndexedExternalWatchChange>()
  const deletedPaths: IndexedPath[] = []

  for (const event of payload.events) {
    if (event.kind === 'overflow') {
      continue
    }
    const eventPath = {
      absolutePath: event.absolutePath,
      identity: pathIdentity(event.absolutePath, allowAliases)
    }
    if (event.kind === 'delete') {
      deletedPaths.push(eventPath)
      continue
    }
    if (event.isDirectory !== true) {
      createOrUpdatePaths.set(eventPath.identity.normalizedPath, event.absolutePath)
    }
    const relativePath = getExternalFileChangeRelativePath(
      scope.worktreePath,
      event.absolutePath,
      event.isDirectory
    )
    if (relativePath && !changesByRelativePath.has(relativePath)) {
      changesByRelativePath.set(relativePath, {
        relativePath,
        absolutePath: joinPath(scope.worktreePath, relativePath),
        identity: eventPath.identity
      })
    }
  }

  const inScope = Object.values(workingDocuments).filter(
    (document) =>
      document.target.worktreeId === scope.worktreeId &&
      document.target.owner.runtimeEnvironmentId === scope.runtimeEnvironmentId
  )
  const matchingDocumentIds = (change: IndexedExternalWatchChange): WorkingDocumentId[] =>
    inScope
      .filter(
        (document) =>
          document.target.relativePath === change.relativePath ||
          pathsMatch(
            pathIdentity(document.target.filePath, allowAliases),
            change.identity,
            allowAliases
          )
      )
      .map((document) => document.id)
  const matchesCreateOrUpdate = (document: WorkingDocument): boolean => {
    const identity = pathIdentity(document.target.filePath, allowAliases)
    return [...createOrUpdatePaths.keys()].some(
      (path) =>
        path === identity.normalizedPath || (allowAliases && path === identity.aliasComparisonPath)
    )
  }
  const deletedWorkingDocuments = inScope.flatMap((document) => {
    const documentPath = pathIdentity(document.target.filePath, allowAliases)
    const deletedPath = deletedPaths.find((path) =>
      pathsMatch(documentPath, path.identity, allowAliases)
    )
    return deletedPath
      ? [{ documentId: document.id, normalizedDeletePath: deletedPath.identity.normalizedPath }]
      : []
  })

  return {
    createOrUpdatePaths,
    changes: [...changesByRelativePath.values()],
    deletedWorkingDocuments,
    matchingDocumentIds,
    matchesCreateOrUpdate
  }
}
