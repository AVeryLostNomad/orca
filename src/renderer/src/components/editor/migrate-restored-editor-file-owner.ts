import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import {
  findWorkspaceFileRoute,
  type RuntimeWorkspaceFileRoute
} from '@/lib/runtime-workspace-file-route'
import {
  assertEditorFileOperationCurrent,
  captureEditorFileOperationProvenance,
  type EditorFileOperationProvenance
} from '@/lib/editor-file-operation-owner'
import { quiesceDocumentSave } from './editor-autosave'
import type { RestoredEditorOwnerResult } from '@/store/slices/editor'

export type RestoredEditorOwnerMigrationResult = RestoredEditorOwnerResult
function getDocumentForTab(
  state: Pick<AppState, 'workingDocuments' | 'workingDocumentIdsByTab'>,
  tabId: string
) {
  const documentId = state.workingDocumentIdsByTab[tabId]?.[0]
  return documentId ? state.workingDocuments[documentId] : undefined
}

export async function migrateRestoredEditorFileOwner(
  fileId: string,
  route: RuntimeWorkspaceFileRoute,
  runtimeEnvironmentId: string | null
): Promise<RestoredEditorOwnerMigrationResult> {
  const state = useAppStore.getState()
  const source = state.openFiles.find((file) => file.id === fileId)
  const sourceDocument = getDocumentForTab(state, fileId)
  const initialRoute = source
    ? findWorkspaceFileRoute(state, route.executionHostId, source.filePath)
    : null
  if (!source || !sourceDocument || !routesMatch(initialRoute, route)) {
    return { ok: false, reason: 'stale' }
  }
  let targetOperationProvenance: EditorFileOperationProvenance
  try {
    targetOperationProvenance = captureEditorFileOperationProvenance(
      state,
      route.worktreeId,
      runtimeEnvironmentId,
      true
    )
  } catch {
    return { ok: false, reason: 'owner-changed' }
  }
  if (sourceDocument.pendingOwnerMigration) {
    return { ok: false, reason: 'stale' }
  }
  state.setWorkingDocumentExternalState(sourceDocument.id, { pendingOwnerMigration: true })

  try {
    await quiesceDocumentSave(sourceDocument.id)
  } catch (error) {
    useAppStore
      .getState()
      .setWorkingDocumentExternalState(sourceDocument.id, { pendingOwnerMigration: undefined })
    throw error
  }
  const currentState = useAppStore.getState()
  const currentSource = currentState.openFiles.find((file) => file.id === fileId)
  const currentRoute = currentSource
    ? findWorkspaceFileRoute(currentState, route.executionHostId, currentSource.filePath)
    : null
  try {
    if (
      currentSource?.filePath !== source.filePath ||
      !routesMatch(currentRoute, route) ||
      assertEditorFileOperationCurrent(currentState, route.worktreeId, targetOperationProvenance)
        .runtimeEnvironmentId !== runtimeEnvironmentId
    ) {
      throw new Error('stale route')
    }
  } catch {
    currentState.setWorkingDocumentExternalState(sourceDocument.id, {
      pendingOwnerMigration: undefined
    })
    return { ok: false, reason: 'owner-changed' }
  }
  return currentState.reparentRestoredEditorFileOwner({
    fileId,
    targetWorktreeId: route.worktreeId,
    targetRelativePath: route.relativePath,
    targetExecutionHostId: route.executionHostId,
    targetRuntimeEnvironmentId: runtimeEnvironmentId,
    targetOperationProvenance
  })
}

function routesMatch(
  current: RuntimeWorkspaceFileRoute | null,
  expected: RuntimeWorkspaceFileRoute
): boolean {
  return (
    current?.worktreeId === expected.worktreeId &&
    current.relativePath === expected.relativePath &&
    current.executionHostId === expected.executionHostId
  )
}
