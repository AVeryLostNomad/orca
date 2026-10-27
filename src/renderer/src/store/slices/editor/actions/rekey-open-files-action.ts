import type { EditorGet, EditorSet } from '../types/editor-set-get'
import type { EditorSlice } from '../types/editor-slice'
import type { AppState } from '../../../types'
import type {
  OpenFilePathRekey,
  RekeyOpenFilesResult,
  WorkingDocumentPathRekey
} from '../types/open-file-path-rekey'
import { rekeyFileIdRecord } from '../file-ids/open-file-path-rekey'
import {
  getWorkingDocumentId,
  getWorkingDocumentTarget,
  type WorkingDocumentId
} from '../working-document'
import { migrateHydratedEditorTabsAndGroups } from '../file-ids/hydrated-editor-file-ids'
import { renameEditorFilesThroughLayoutOwner } from '../tabs/editor-file-rename-through-layout-owner'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../../../../shared/layout-owner-switch'

// The store change is pure, so a layout-owner build applies it in the frame that shows main's rename.
export type RekeyOpenFilesPatch =
  | { ok: true; patch: Partial<AppState> }
  | Extract<RekeyOpenFilesResult, { ok: false }>

/** The rekey of `s`; refused as a whole when a source is gone or two files would share an id. */
export function rekeyOpenFilesPatch(
  s: AppState,
  rekeys: readonly OpenFilePathRekey[],
  moveOperationId: string | undefined,
  /** Retained combined-only documents that have no ordinary OpenFile. */
  documentRekeys: readonly WorkingDocumentPathRekey[] = []
): RekeyOpenFilesPatch {
  const migrations = new Map<string, string>()
  const rekeyByOldId = new Map<string, OpenFilePathRekey>()
  for (const rekey of rekeys) {
    migrations.set(rekey.oldFileId, rekey.newFileId)
    rekeyByOldId.set(rekey.oldFileId, rekey)
  }
  const openById = new Map(s.openFiles.map((f) => [f.id, f]))

  // Preflight atomically: all sources open, unique targets and no target owned by unaffected sessions; never merge two.
  const seenNewIds = new Set<string>()
  for (const rekey of rekeys) {
    if (!openById.has(rekey.oldFileId)) {
      return { ok: false, reason: 'stale' }
    }
    if (seenNewIds.has(rekey.newFileId)) {
      return { ok: false, reason: 'collision' }
    }
    seenNewIds.add(rekey.newFileId)
    const occupier = openById.get(rekey.newFileId)
    if (occupier && !migrations.has(occupier.id)) {
      return { ok: false, reason: 'collision' }
    }
  }

  // Documents are keyed by owner+path, so a move migrates each one once however many tabs view it.
  const documentMigrations = new Map<WorkingDocumentId, WorkingDocumentId>()
  const documentRekeyByOldId = new Map<WorkingDocumentId, WorkingDocumentPathRekey>()
  const planDocumentMove = (
    oldDocumentId: WorkingDocumentId,
    newDocumentId: WorkingDocumentId,
    rekey: WorkingDocumentPathRekey
  ): boolean => {
    const document = s.workingDocuments[oldDocumentId]
    const destination = s.workingDocuments[newDocumentId]
    if (
      document &&
      destination &&
      destination.id !== oldDocumentId &&
      (document.isDirty || destination.isDirty)
    ) {
      return false
    }
    documentMigrations.set(oldDocumentId, newDocumentId)
    documentRekeyByOldId.set(oldDocumentId, rekey)
    return true
  }
  for (const rekey of rekeys) {
    const target = getWorkingDocumentTarget(openById.get(rekey.oldFileId)!)
    if (!target) {
      continue
    }
    const oldDocumentId = getWorkingDocumentId(target.owner, target.filePath)
    if (!s.workingDocuments[oldDocumentId]) {
      continue
    }
    const moved = planDocumentMove(
      oldDocumentId,
      getWorkingDocumentId(target.owner, rekey.newFilePath),
      {
        documentId: oldDocumentId,
        oldFilePath: rekey.oldFilePath,
        newFilePath: rekey.newFilePath,
        newRelativePath: rekey.newRelativePath,
        newLanguage: rekey.newLanguage
      }
    )
    if (!moved) {
      return { ok: false, reason: 'collision' }
    }
  }
  for (const rekey of documentRekeys) {
    const oldDocumentId = rekey.documentId as WorkingDocumentId
    const document = s.workingDocuments[oldDocumentId]
    if (!document || document.target.filePath !== rekey.oldFilePath) {
      return { ok: false, reason: 'stale' }
    }
    if (
      !planDocumentMove(
        oldDocumentId,
        getWorkingDocumentId(document.target.owner, rekey.newFilePath),
        rekey
      )
    ) {
      return { ok: false, reason: 'collision' }
    }
  }

  const nextOpenFiles = s.openFiles.map((f) => {
    const rekey = rekeyByOldId.get(f.id)
    if (!rekey) {
      return f
    }
    // Spread the whole OpenFile so fields this action doesn't know about survive; change only the path-derived ones.
    return {
      ...f,
      id: rekey.newFileId,
      filePath: rekey.newFilePath,
      relativePath: rekey.newRelativePath,
      // After move, host snapshot IDs no longer match: detach host ownership to protect draft, and coordinator closes old-path host tab. In-place host rehome remains follow-up.
      mirroredFromRuntimeSession: undefined,
      ...(rekey.newLanguage !== undefined ? { language: rekey.newLanguage } : {}),
      ...(rekey.newMarkdownPreviewSourceFileId !== undefined
        ? { markdownPreviewSourceFileId: rekey.newMarkdownPreviewSourceFileId }
        : {}),
      ...(rekey.consumeUntitled
        ? { isUntitled: undefined, deleteUntouchedOnClose: undefined }
        : {})
    }
  })

  const workingDocuments = { ...s.workingDocuments }
  for (const [oldDocumentId, newDocumentId] of documentMigrations) {
    const document = workingDocuments[oldDocumentId]
    const rekey = documentRekeyByOldId.get(oldDocumentId)
    if (!document || !rekey) {
      continue
    }
    const destination = workingDocuments[newDocumentId]
    delete workingDocuments[oldDocumentId]
    if (destination) {
      continue
    }
    workingDocuments[newDocumentId] = {
      ...document,
      id: newDocumentId,
      target: {
        ...document.target,
        filePath: rekey.newFilePath,
        relativePath: rekey.newRelativePath,
        ...(rekey.newLanguage === undefined ? {} : { language: rekey.newLanguage })
      },
      // Only dirty documents need their destination echo verified; a 'changed' one already shows the banner.
      ...(moveOperationId !== undefined &&
      document.isDirty &&
      document.externalMutation !== 'changed'
        ? {
            pendingLiveDiskVerification: true,
            pendingSelfMoveEcho: { operationId: moveOperationId, targetPath: rekey.newFilePath }
          }
        : {})
    }
  }
  const workingDocumentIdsByTab = Object.entries(s.workingDocumentIdsByTab).reduce<
    typeof s.workingDocumentIdsByTab
  >((next, [tabId, ids]) => {
    const mappedTabId = migrations.get(tabId) ?? tabId
    const mappedIds = ids.map((id) => documentMigrations.get(id) ?? id)
    next[mappedTabId] = [...new Set([...(next[mappedTabId] ?? []), ...mappedIds])]
    return next
  }, {})

  const activeFileIdByWorktree: Record<string, string | null> = {}
  for (const [wtId, activeId] of Object.entries(s.activeFileIdByWorktree)) {
    activeFileIdByWorktree[wtId] = activeId ? (migrations.get(activeId) ?? activeId) : activeId
  }

  // Partition by each file’s workspace; same paths can be open in multiple workspaces with independent tab/group state.
  const migrationsByWorktree: Record<string, Map<string, string>> = {}
  for (const rekey of rekeys) {
    const wtId = openById.get(rekey.oldFileId)!.worktreeId
    ;(migrationsByWorktree[wtId] ??= new Map()).set(rekey.oldFileId, rekey.newFileId)
  }

  const tabBarOrderByWorktree = { ...s.tabBarOrderByWorktree }
  for (const [wtId, wtMigrations] of Object.entries(migrationsByWorktree)) {
    const prevBarOrder = tabBarOrderByWorktree[wtId]
    if (prevBarOrder) {
      tabBarOrderByWorktree[wtId] = prevBarOrder.map((id) => wtMigrations.get(id) ?? id)
    }
  }

  const reveal = s.pendingEditorReveal
  // Why: two worktrees can rekey the same oldFilePath, so an id-keyed reveal must match its own file, not the first path match.
  const rekeyForReveal = !reveal
    ? undefined
    : reveal.fileId
      ? rekeyByOldId.get(reveal.fileId)
      : rekeys.find((r) => r.oldFilePath === reveal.filePath)

  return {
    ok: true,
    patch: {
      openFiles: nextOpenFiles,
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
      activeFileIdByWorktree,
      tabBarOrderByWorktree,
      ...migrateHydratedEditorTabsAndGroups(s, migrationsByWorktree),
      ...(reveal && rekeyForReveal
        ? {
            pendingEditorReveal: {
              ...reveal,
              filePath: rekeyForReveal.newFilePath,
              // Migrate fileId too; pending reveals prefer it and otherwise never match moved tabs.
              ...(reveal.fileId ? { fileId: migrations.get(reveal.fileId) ?? reveal.fileId } : {})
            }
          }
        : {})
    }
  }
}

export function createRekeyOpenFilesAction(
  set: EditorSet,
  get: EditorGet
): Pick<EditorSlice, 'rekeyOpenFilesForPathChange'> {
  return {
    rekeyOpenFilesForPathChange: ({ rekeys, documentRekeys = [], moveOperationId }) => {
      if (rekeys.length === 0 && documentRekeys.length === 0) {
        return { ok: true }
      }
      // Switch point: main renames the tabs, and its frame rekeys the content.
      if (ORCA_LAYOUT_OWNER_IS_MAIN && rekeys.length > 0) {
        // Tabless documents have no frame to wait for; move them with the window's own store.
        if (documentRekeys.length > 0) {
          const documentsOnly = rekeyOpenFilesPatch(get(), [], moveOperationId, documentRekeys)
          if (!documentsOnly.ok) {
            return documentsOnly
          }
          set(documentsOnly.patch)
        }
        return renameEditorFilesThroughLayoutOwner(
          set,
          get,
          rekeys,
          moveOperationId,
          rekeyOpenFilesPatch
        )
      }
      let result: RekeyOpenFilesResult = { ok: true }
      set((s) => {
        const next = rekeyOpenFilesPatch(s, rekeys, moveOperationId, documentRekeys)
        if (!next.ok) {
          result = next
          return s
        }
        return next.patch
      })
      return result
    }
  }
}
