import type { ActiveWorktreeStateTransition } from '../../worktree-helpers'
import type { TabGroup } from '../../../../../../shared/tab-types'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { sanitizeRecentTabIds } from '../../tab-group-state'
import {
  nextActiveIdAfterRemoval,
  removeEmptyEditorGroups,
  removeTabIdsFromGroup,
  rekeyFileIdRecord
} from '../file-ids/open-file-path-rekey'
import type {
  RestoredEditorOwnerMigration,
  RestoredEditorOwnerResult
} from '../types/restored-editor-owner'
import { resolveRestoredEditorOwnerDestination } from './restored-editor-owner-destination'
import { migrateRestoredEditorActiveGroupIds } from './restored-editor-owner-active-groups'
import { resolveRestoredEditorExternalSshTargetId } from './restored-editor-owner-execution-target'
import { migrateRestoredEditorPendingState } from './restored-editor-owner-pending-state'
import {
  getWorkingDocumentId,
  getWorkingDocumentOwner,
  type WorkingDocumentId
} from '../working-document'

export function buildRestoredEditorOwnerTransition(
  args: RestoredEditorOwnerMigration,
  assignResult: (result: RestoredEditorOwnerResult) => void
): ActiveWorktreeStateTransition {
  return (s) => {
    const destination = resolveRestoredEditorOwnerDestination(s, args)
    if (!destination.ok) {
      assignResult({ ok: false, reason: destination.reason })
      return destination.reason === 'stale'
        ? { patch: {}, activate: false }
        : { patch: destination.patch, activate: false }
    }
    const { source, newFileId, previewIdMigrations, operationProvenance } = destination
    const externalSshTargetId = resolveRestoredEditorExternalSshTargetId(
      args.targetExecutionHostId,
      args.targetRuntimeEnvironmentId
    )
    const migrations = new Map([[source.id, newFileId], ...previewIdMigrations])
    const movedFileIds = new Set(migrations.keys())
    const sourceWorktreeId = source.worktreeId
    const targetWorktreeId = args.targetWorktreeId
    const movedTabs = (s.unifiedTabsByWorktree[sourceWorktreeId] ?? []).filter((tab) =>
      movedFileIds.has(tab.entityId)
    )
    const movedTabIds = new Set(movedTabs.map((tab) => tab.id))
    const tabIdMigration = new Map(
      movedTabs.map((tab) => [tab.id, migrations.get(tab.id) ?? tab.id])
    )
    const mappedMovedTabIds = movedTabs.map((tab) => tabIdMigration.get(tab.id) ?? tab.id)
    const mappedMovedTabIdSet = new Set(mappedMovedTabIds)
    const mappedMovedTabBarIds = movedTabs.map(
      (tab) => migrations.get(tab.entityId) ?? tab.entityId
    )
    const targetGroups = s.groupsByWorktree[targetWorktreeId] ?? []
    const targetGroupId =
      s.activeGroupIdByWorktree[targetWorktreeId] ?? targetGroups[0]?.id ?? createBrowserUuid()
    const targetGroup = targetGroups.find((group) => group.id === targetGroupId) ?? {
      id: targetGroupId,
      worktreeId: targetWorktreeId,
      activeTabId: null,
      tabOrder: []
    }

    const previousSourceGroups = s.groupsByWorktree[sourceWorktreeId] ?? []
    const updatedSourceGroups = previousSourceGroups.map((group) => {
      const tabOrder = group.tabOrder.filter((id) => !movedTabIds.has(id))
      const activeTabId =
        group.activeTabId && movedTabIds.has(group.activeTabId)
          ? nextActiveIdAfterRemoval(group.tabOrder, group.recentTabIds, movedTabIds)
          : group.activeTabId
      return {
        ...group,
        activeTabId,
        tabOrder,
        recentTabIds: sanitizeRecentTabIds(
          (group.recentTabIds ?? []).filter((id) => !movedTabIds.has(id)),
          tabOrder
        )
      }
    })
    const sourceGroupState = removeEmptyEditorGroups(
      previousSourceGroups,
      updatedSourceGroups,
      movedTabIds,
      s.layoutByWorktree[sourceWorktreeId]
    )
    const destinationOrder = [
      ...targetGroup.tabOrder.filter((id) => !mappedMovedTabIds.includes(id)),
      ...mappedMovedTabIds
    ]
    const updatedTargetGroup: TabGroup = {
      ...targetGroup,
      activeTabId: mappedMovedTabIds.at(-1) ?? targetGroup.activeTabId,
      tabOrder: destinationOrder,
      recentTabIds: sanitizeRecentTabIds(
        [...(targetGroup.recentTabIds ?? []), ...mappedMovedTabIds],
        destinationOrder
      )
    }
    // Why: the migrated ids land in targetGroup only, so any sibling group holding the same id is left dangling.
    const nextTargetGroups = targetGroups.some((group) => group.id === targetGroupId)
      ? targetGroups.map((group) =>
          group.id === targetGroupId
            ? updatedTargetGroup
            : removeTabIdsFromGroup(group, mappedMovedTabIdSet)
        )
      : [
          ...targetGroups.map((group) => removeTabIdsFromGroup(group, mappedMovedTabIdSet)),
          updatedTargetGroup
        ]

    const nextUnifiedTabsByWorktree = { ...s.unifiedTabsByWorktree }
    nextUnifiedTabsByWorktree[sourceWorktreeId] = (
      nextUnifiedTabsByWorktree[sourceWorktreeId] ?? []
    ).filter((tab) => !movedTabIds.has(tab.id))
    nextUnifiedTabsByWorktree[targetWorktreeId] = [
      // Why: a leftover target tab carrying a migrated id would duplicate the id that destinationOrder keeps only once.
      ...(nextUnifiedTabsByWorktree[targetWorktreeId] ?? []).filter(
        (tab) => !mappedMovedTabIdSet.has(tab.id)
      ),
      ...movedTabs.map((tab) => ({
        ...tab,
        id: tabIdMigration.get(tab.id) ?? tab.id,
        entityId: migrations.get(tab.entityId) ?? tab.entityId,
        groupId: targetGroupId
      }))
    ]

    const nextGroupsByWorktree = {
      ...s.groupsByWorktree,
      [sourceWorktreeId]: sourceGroupState.groups,
      [targetWorktreeId]: nextTargetGroups
    }
    const nextLayoutByWorktree = { ...s.layoutByWorktree }
    if (sourceGroupState.layout) {
      nextLayoutByWorktree[sourceWorktreeId] = sourceGroupState.layout
    } else {
      delete nextLayoutByWorktree[sourceWorktreeId]
    }
    if (targetGroups.length === 0 || !nextLayoutByWorktree[targetWorktreeId]) {
      nextLayoutByWorktree[targetWorktreeId] = { type: 'leaf', groupId: targetGroupId }
    }

    const nextActiveFileIdByWorktree = { ...s.activeFileIdByWorktree }
    const sourceActiveFileId = nextActiveFileIdByWorktree[sourceWorktreeId]
    if (sourceActiveFileId && movedFileIds.has(sourceActiveFileId)) {
      nextActiveFileIdByWorktree[sourceWorktreeId] =
        s.openFiles.find(
          (file) => !movedFileIds.has(file.id) && file.worktreeId === sourceWorktreeId
        )?.id ?? null
    }
    nextActiveFileIdByWorktree[targetWorktreeId] = newFileId
    const nextTabBarOrderByWorktree = { ...s.tabBarOrderByWorktree }
    nextTabBarOrderByWorktree[sourceWorktreeId] = (
      nextTabBarOrderByWorktree[sourceWorktreeId] ?? []
    ).filter((id) => !movedFileIds.has(id) && !movedTabIds.has(id))
    nextTabBarOrderByWorktree[targetWorktreeId] = [
      ...(nextTabBarOrderByWorktree[targetWorktreeId] ?? []).filter(
        (id) => !mappedMovedTabBarIds.includes(id)
      ),
      ...mappedMovedTabBarIds
    ]
    const nextActiveGroupIdByWorktree = migrateRestoredEditorActiveGroupIds(
      s.activeGroupIdByWorktree,
      sourceGroupState.groups.map((group) => group.id),
      sourceWorktreeId,
      targetWorktreeId,
      targetGroupId
    )
    const sourceTabIds = [
      source.id,
      ...(s.unifiedTabsByWorktree[sourceWorktreeId] ?? [])
        .filter((tab) => tab.entityId === source.id)
        .map((tab) => tab.id)
    ]
    const sourceDocumentId = sourceTabIds
      .flatMap((tabId) => s.workingDocumentIdsByTab[tabId] ?? [])
      .find((documentId) => {
        const document = s.workingDocuments[documentId]
        return document?.target.filePath === source.filePath
      })
    const sourceDocument = sourceDocumentId ? s.workingDocuments[sourceDocumentId] : undefined
    const targetOwner = getWorkingDocumentOwner(operationProvenance)
    const targetDocumentId = sourceDocument
      ? getWorkingDocumentId(targetOwner, sourceDocument.target.filePath)
      : undefined
    const destinationDocument = targetDocumentId ? s.workingDocuments[targetDocumentId] : undefined
    if (
      sourceDocument &&
      destinationDocument &&
      sourceDocumentId !== targetDocumentId &&
      (sourceDocument.isDirty || destinationDocument.isDirty)
    ) {
      assignResult({ ok: false, reason: 'collision' })
      return { patch: {}, activate: false }
    }
    const workingDocuments = { ...s.workingDocuments }
    if (sourceDocument && sourceDocumentId && targetDocumentId) {
      if (sourceDocumentId !== targetDocumentId) {
        delete workingDocuments[sourceDocumentId]
      }
      if (!destinationDocument || sourceDocumentId === targetDocumentId) {
        workingDocuments[targetDocumentId] = {
          ...sourceDocument,
          id: targetDocumentId,
          target: {
            ...sourceDocument.target,
            owner: targetOwner,
            worktreeId: targetWorktreeId,
            relativePath: args.targetRelativePath,
            externalSshTargetId,
            operationProvenance
          },
          pendingOwnerMigration: undefined
        }
      }
    }
    const workingDocumentIdsByTab = Object.entries(s.workingDocumentIdsByTab).reduce(
      (memberships, [tabId, documentIds]) => {
        const nextTabId = tabId === source.id ? newFileId : tabId
        const nextDocumentIds =
          sourceDocumentId && targetDocumentId
            ? documentIds.map((id) => (id === sourceDocumentId ? targetDocumentId : id))
            : documentIds
        const existing = memberships[nextTabId] ?? []
        memberships[nextTabId] = [...new Set([...existing, ...nextDocumentIds])]
        return memberships
      },
      {} as Record<string, readonly WorkingDocumentId[]>
    )
    assignResult({ ok: true, fileId: newFileId })
    return {
      patch: {
        openFiles: s.openFiles.map((file) =>
          file.id === source.id
            ? {
                ...file,
                id: newFileId,
                worktreeId: targetWorktreeId,
                relativePath: args.targetRelativePath,
                runtimeEnvironmentId: args.targetRuntimeEnvironmentId,
                externalSshTargetId,
                operationProvenance,
                mirroredFromRuntimeSession: undefined
              }
            : file.markdownPreviewSourceFileId === source.id
              ? {
                  ...file,
                  id: previewIdMigrations.get(file.id) ?? file.id,
                  worktreeId: targetWorktreeId,
                  relativePath: args.targetRelativePath,
                  runtimeEnvironmentId: args.targetRuntimeEnvironmentId,
                  externalSshTargetId,
                  operationProvenance,
                  markdownPreviewSourceFileId: newFileId,
                  mirroredFromRuntimeSession: undefined
                }
              : file
        ),
        workingDocuments,
        workingDocumentIdsByTab,
        editorCursorLine: rekeyFileIdRecord(s.editorCursorLine, migrations),
        markdownViewMode: rekeyFileIdRecord(s.markdownViewMode, migrations),
        markdownRichModeSizeOverride: rekeyFileIdRecord(s.markdownRichModeSizeOverride, migrations),
        editorViewMode: rekeyFileIdRecord(s.editorViewMode, migrations),
        markdownFrontmatterVisible: rekeyFileIdRecord(s.markdownFrontmatterVisible, migrations),
        markdownTableOfContentsVisible: rekeyFileIdRecord(
          s.markdownTableOfContentsVisible,
          migrations
        ),
        activeFileId: s.activeFileId ? (migrations.get(s.activeFileId) ?? s.activeFileId) : null,
        activeFileIdByWorktree: nextActiveFileIdByWorktree,
        activeTabTypeByWorktree: {
          ...s.activeTabTypeByWorktree,
          [targetWorktreeId]: 'editor'
        },
        unifiedTabsByWorktree: nextUnifiedTabsByWorktree,
        groupsByWorktree: nextGroupsByWorktree,
        layoutByWorktree: nextLayoutByWorktree,
        activeGroupIdByWorktree: nextActiveGroupIdByWorktree,
        tabBarOrderByWorktree: nextTabBarOrderByWorktree,
        ...migrateRestoredEditorPendingState(
          s,
          migrations,
          source.filePath,
          sourceWorktreeId,
          targetWorktreeId
        )
      },
      activate: true,
      preferredActiveUnifiedTabId: mappedMovedTabIds.at(-1)
    }
  }
}
