import { useAppStore } from '@/store'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import { basename } from '@/lib/path'
import { indexEditorExternalWatchBatchPaths } from '@/components/editor/editor-external-watch-path-index'
import { getRecentSelfWrite } from '@/components/editor/editor-self-write-registry'
import {
  hasActiveEditorPathMoves,
  isActiveMoveSourcePath
} from '@/components/editor/editor-path-move-inflight'
import { normalizeRuntimePathForComparison } from '../../../shared/cross-platform-path'
import type { FsChangedPayload } from '../../../shared/filesystem-entry-types'
import {
  ORCA_WORKTREE_FILE_CHANGE_EVENT,
  type WorktreeFileChangeEventDetail
} from './worktree-file-change-event'
import {
  getLocalWindowsWslAliasOption,
  type EditorExternalWatchTarget
} from './editor-external-watch-targets'
import {
  scheduleDebouncedEditorExternalReload,
  scheduleEditorChangedOnDiskMark,
  scheduleEditorSelfMoveEchoVerification,
  scheduleSelfWriteAwareEditorExternalReload,
  type EditorExternalWatchNotification
} from './editor-external-watch-disk-verification'

const EXTERNAL_MUTATION_DEBOUNCE_MS = 75
type PendingDeleteTimer = {
  documentId: WorkingDocumentId
  timer: ReturnType<typeof setTimeout>
}

export function buildEditorExternalWatchEventHandler(
  findTarget: (
    worktreePath: string,
    runtimeEnvironmentId: string | null
  ) => EditorExternalWatchTarget | undefined
): {
  handleFsChanged: (payload: FsChangedPayload, runtimeEnvironmentId?: string | null) => void
  dispose: () => void
} {
  const pendingDeletes = new Map<string, PendingDeleteTimer>()
  const pendingKey = (
    worktreeId: string,
    runtimeEnvironmentId: string | null,
    path: string
  ): string => `${worktreeId}::${runtimeEnvironmentId ?? 'client'}::${path}`

  const handleFsChanged = (
    payload: FsChangedPayload,
    runtimeEnvironmentId: string | null = null
  ): void => {
    const target = findTarget(payload.worktreePath, runtimeEnvironmentId)
    if (!target) {
      return
    }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(
        new CustomEvent<WorktreeFileChangeEventDetail>(ORCA_WORKTREE_FILE_CHANGE_EVENT, {
          detail: { payload, runtimeEnvironmentId: target.runtimeEnvironmentId }
        })
      )
    }

    const stateAtStart = useAppStore.getState()
    const batchPaths = indexEditorExternalWatchBatchPaths(payload, stateAtStart.workingDocuments, {
      worktreeId: target.worktreeId,
      worktreePath: target.worktreePath,
      runtimeEnvironmentId: target.runtimeEnvironmentId,
      ...getLocalWindowsWslAliasOption(target)
    })
    for (const createdPath of batchPaths.createOrUpdatePaths.keys()) {
      const key = pendingKey(target.worktreeId, target.runtimeEnvironmentId, createdPath)
      const pending = pendingDeletes.get(key)
      if (pending) {
        clearTimeout(pending.timer)
        pendingDeletes.delete(key)
      }
    }

    const deletedDocuments = batchPaths.deletedWorkingDocuments.filter(({ documentId }) => {
      const document = stateAtStart.workingDocuments[documentId]
      return (
        document &&
        (!hasActiveEditorPathMoves() ||
          !isActiveMoveSourcePath(
            target.worktreeId,
            target.runtimeEnvironmentId,
            document.target.filePath
          ))
      )
    })
    if (deletedDocuments.length > 0) {
      const hasPairedCreate = hasRenameCorrelatedCreate(
        payload,
        deletedDocuments.map(({ documentId }) => {
          const document = stateAtStart.workingDocuments[documentId]
          return document?.target.filePath ?? ''
        })
      )
      if (hasPairedCreate) {
        for (const { documentId } of deletedDocuments) {
          useAppStore
            .getState()
            .setWorkingDocumentExternalState(documentId, { externalMutation: 'renamed' })
        }
      } else {
        for (const { documentId, normalizedDeletePath } of deletedDocuments) {
          const key = pendingKey(
            target.worktreeId,
            target.runtimeEnvironmentId,
            normalizedDeletePath
          )
          const existing = pendingDeletes.get(key)
          if (existing) {
            clearTimeout(existing.timer)
          }
          const timer = setTimeout(() => {
            pendingDeletes.delete(key)
            const document = useAppStore.getState().workingDocuments[documentId]
            if (document) {
              useAppStore
                .getState()
                .setWorkingDocumentExternalState(documentId, { externalMutation: 'deleted' })
            }
          }, EXTERNAL_MUTATION_DEBOUNCE_MS)
          pendingDeletes.set(key, { documentId, timer })
        }
      }
    }

    if (batchPaths.createOrUpdatePaths.size > 0) {
      const state = useAppStore.getState()
      for (const document of Object.values(state.workingDocuments)) {
        if (
          document.target.worktreeId === target.worktreeId &&
          document.target.owner.runtimeEnvironmentId === target.runtimeEnvironmentId &&
          (document.externalMutation === 'deleted' || document.externalMutation === 'renamed') &&
          batchPaths.matchesCreateOrUpdate(document)
        ) {
          state.setWorkingDocumentExternalState(document.id, { externalMutation: undefined })
        }
      }
    }

    if (payload.events.some((event) => event.kind === 'overflow')) {
      for (const notification of collectOverflowEditorExternalReloadTargets(target)) {
        scheduleDebouncedEditorExternalReload(notification)
      }
      return
    }

    for (const change of batchPaths.changes) {
      const documentIds = batchPaths.matchingDocumentIds(change)
      const notification: EditorExternalWatchNotification = {
        worktreeId: target.worktreeId,
        worktreePath: target.worktreePath,
        relativePath: change.relativePath,
        runtimeEnvironmentId: target.runtimeEnvironmentId,
        ...getLocalWindowsWslAliasOption(target)
      }
      if (documentIds.length === 0) {
        scheduleDebouncedEditorExternalReload(notification)
        continue
      }
      const state = useAppStore.getState()
      const dirtyDocumentIds = documentIds.filter(
        (documentId) => state.workingDocuments[documentId]?.isDirty
      )
      if (dirtyDocumentIds.length > 0) {
        const selfMoveDocumentIds = dirtyDocumentIds.filter((documentId) => {
          const move = state.workingDocuments[documentId]?.pendingSelfMoveEcho
          return (
            move &&
            normalizeRuntimePathForComparison(move.targetPath) ===
              normalizeRuntimePathForComparison(change.absolutePath)
          )
        })
        if (selfMoveDocumentIds.length > 0) {
          scheduleEditorSelfMoveEchoVerification(target.connectionId, selfMoveDocumentIds, true)
        }
        const changedDocumentIds = dirtyDocumentIds.filter(
          (documentId) => !selfMoveDocumentIds.includes(documentId)
        )
        scheduleEditorChangedOnDiskMark(target, changedDocumentIds)
      }

      const cleanDocument = documentIds
        .map((documentId) => state.workingDocuments[documentId])
        .find((document) => document && !document.isDirty)
      if (cleanDocument) {
        const recentSelfWrite = getRecentSelfWrite(cleanDocument.id)
        if (recentSelfWrite) {
          scheduleSelfWriteAwareEditorExternalReload(
            target,
            notification,
            cleanDocument,
            recentSelfWrite
          )
        } else {
          scheduleDebouncedEditorExternalReload(notification)
        }
      }
    }
  }

  const dispose = (): void => {
    for (const pending of pendingDeletes.values()) {
      clearTimeout(pending.timer)
    }
    pendingDeletes.clear()
  }

  return { handleFsChanged, dispose }
}

export function collectOverflowEditorExternalReloadTargets(
  target: Pick<EditorExternalWatchTarget, 'worktreeId' | 'worktreePath'> &
    Partial<Pick<EditorExternalWatchTarget, 'runtimeEnvironmentId' | 'allowLocalWindowsWslAliases'>>
): EditorExternalWatchNotification[] {
  const state = useAppStore.getState()
  const notifications: EditorExternalWatchNotification[] = []
  for (const document of Object.values(state.workingDocuments)) {
    if (
      document.target.worktreeId !== target.worktreeId ||
      document.target.owner.runtimeEnvironmentId !== (target.runtimeEnvironmentId ?? null) ||
      document.isDirty
    ) {
      continue
    }
    if (document.externalMutation) {
      state.setWorkingDocumentExternalState(document.id, { externalMutation: undefined })
    }
    notifications.push({
      worktreeId: target.worktreeId,
      worktreePath: target.worktreePath,
      relativePath: document.target.relativePath,
      runtimeEnvironmentId: target.runtimeEnvironmentId ?? null,
      ...getLocalWindowsWslAliasOption(target)
    })
  }
  return notifications
}

function hasRenameCorrelatedCreate(
  payload: FsChangedPayload,
  deletedPaths: readonly string[]
): boolean {
  const deletedBasenames = new Set(deletedPaths.filter(Boolean).map((path) => basename(path)))
  return (
    deletedBasenames.size > 0 &&
    payload.events.some(
      (event) =>
        event.kind === 'create' &&
        event.isDirectory !== true &&
        deletedBasenames.has(basename(event.absolutePath))
    )
  )
}
