import type { EditorGet, EditorSet } from '../types/editor-set-get'
import type { EditorSlice } from '../types/editor-slice'
import type {
  OpenFilePathRekey,
  RekeyOpenFilesResult,
  WorkingDocumentPathRekey
} from '../types/open-file-path-rekey'
import { rekeyFileIdRecord } from '../file-ids/open-file-path-rekey'
import { migrateHydratedEditorTabsAndGroups } from '../file-ids/hydrated-editor-file-ids'
import {
  getWorkingDocumentId,
  getWorkingDocumentTarget,
  type WorkingDocumentId
} from '../working-document'

export function createRekeyOpenFilesAction(
  set: EditorSet,
  _get: EditorGet
): Pick<EditorSlice, 'rekeyOpenFilesForPathChange'> {
  return {
    rekeyOpenFilesForPathChange: ({ rekeys, documentRekeys = [], moveOperationId }) => {
      if (rekeys.length === 0 && documentRekeys.length === 0) {
        return { ok: true }
      }
      let result: RekeyOpenFilesResult = { ok: true }
      set((s) => {
        const migrations = new Map<string, string>()
        const rekeyByOldId = new Map<string, OpenFilePathRekey>()
        for (const rekey of rekeys) {
          migrations.set(rekey.oldFileId, rekey.newFileId)
          rekeyByOldId.set(rekey.oldFileId, rekey)
        }
        const openById = new Map(s.openFiles.map((f) => [f.id, f]))

        // Preflight (atomic with apply): every source still open, target ids unique,
        // and no target id belongs to an UNAFFECTED live session (never merge two).
        const seenNewIds = new Set<string>()
        for (const rekey of rekeys) {
          if (!openById.has(rekey.oldFileId)) {
            result = { ok: false, reason: 'stale' }
            return s
          }
          if (seenNewIds.has(rekey.newFileId)) {
            result = { ok: false, reason: 'collision' }
            return s
          }
          seenNewIds.add(rekey.newFileId)
          const occupier = openById.get(rekey.newFileId)
          if (occupier && !migrations.has(occupier.id)) {
            result = { ok: false, reason: 'collision' }
            return s
          }
        }
        const documentMigrations = new Map<WorkingDocumentId, WorkingDocumentId>()
        const documentRekeyByOldId = new Map<WorkingDocumentId, WorkingDocumentPathRekey>()
        for (const rekey of rekeys) {
          const source = openById.get(rekey.oldFileId)!
          const target = getWorkingDocumentTarget(source)
          if (!target) {
            continue
          }
          const oldDocumentId = getWorkingDocumentId(target.owner, target.filePath)
          const document = s.workingDocuments[oldDocumentId]
          if (!document) {
            continue
          }
          const newDocumentId = getWorkingDocumentId(target.owner, rekey.newFilePath)
          const destination = s.workingDocuments[newDocumentId]
          if (
            destination &&
            destination.id !== oldDocumentId &&
            (document.isDirty || destination.isDirty)
          ) {
            result = { ok: false, reason: 'collision' }
            return s
          }
          documentMigrations.set(oldDocumentId, newDocumentId)
          documentRekeyByOldId.set(oldDocumentId, {
            documentId: oldDocumentId,
            oldFilePath: rekey.oldFilePath,
            newFilePath: rekey.newFilePath,
            newRelativePath: rekey.newRelativePath,
            newLanguage: rekey.newLanguage
          })
        }
        for (const rekey of documentRekeys) {
          const oldDocumentId = rekey.documentId as WorkingDocumentId
          const document = s.workingDocuments[oldDocumentId]
          if (!document || document.target.filePath !== rekey.oldFilePath) {
            result = { ok: false, reason: 'stale' }
            return s
          }
          const newDocumentId = getWorkingDocumentId(document.target.owner, rekey.newFilePath)
          const destination = s.workingDocuments[newDocumentId]
          if (
            destination &&
            destination.id !== oldDocumentId &&
            (document.isDirty || destination.isDirty)
          ) {
            result = { ok: false, reason: 'collision' }
            return s
          }
          documentMigrations.set(oldDocumentId, newDocumentId)
          documentRekeyByOldId.set(oldDocumentId, rekey)
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
            // A moved tab's id no longer matches the host snapshot, so leaving it host-owned would cull it (losing the draft); the coordinator close-notifies the host's old-path tab. (Re-homing the host tab in place is a follow-up.)
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
          if (!document) {
            continue
          }
          const rekey = documentRekeyByOldId.get(oldDocumentId)
          if (!rekey) {
            continue
          }
          const destination = workingDocuments[newDocumentId]
          delete workingDocuments[oldDocumentId]
          if (!destination) {
            workingDocuments[newDocumentId] = {
              ...document,
              id: newDocumentId,
              target: {
                ...document.target,
                filePath: rekey.newFilePath,
                relativePath: rekey.newRelativePath,
                ...(rekey.newLanguage === undefined ? {} : { language: rekey.newLanguage })
              },
              ...(moveOperationId !== undefined &&
              document.isDirty &&
              document.externalMutation !== 'changed'
                ? {
                    pendingLiveDiskVerification: true,
                    pendingSelfMoveEcho: {
                      operationId: moveOperationId,
                      targetPath: rekey.newFilePath
                    }
                  }
                : {})
            }
          }
        }
        const workingDocumentIdsByTab = Object.entries(s.workingDocumentIdsByTab).reduce<
          typeof s.workingDocumentIdsByTab
        >((next, [tabId, ids]) => {
          const mappedTabId = migrations.get(tabId) ?? tabId
          const mappedIds = ids.map((id) => documentMigrations.get(id) ?? id)
          const existing = next[mappedTabId] ?? []
          next[mappedTabId] = [...new Set([...existing, ...mappedIds])]
          return next
        }, {})

        const activeFileIdByWorktree: Record<string, string | null> = {}
        for (const [wtId, activeId] of Object.entries(s.activeFileIdByWorktree)) {
          activeFileIdByWorktree[wtId] = activeId
            ? (migrations.get(activeId) ?? activeId)
            : activeId
        }

        // Partition by each moved file's OWN worktree: the same path can be open in more than one worktree (e.g. a floating workspace), and tab-bar / group state is per-worktree.
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
          openFiles: nextOpenFiles,
          workingDocuments,
          workingDocumentIdsByTab,
          editorCursorLine: rekeyFileIdRecord(s.editorCursorLine, migrations),
          markdownViewMode: rekeyFileIdRecord(s.markdownViewMode, migrations),
          markdownRichModeSizeOverride: rekeyFileIdRecord(
            s.markdownRichModeSizeOverride,
            migrations
          ),
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
                  // matchesPendingEditorReveal prefers fileId, so migrate it too or
                  // the reveal would never match the rekeyed tab.
                  ...(reveal.fileId
                    ? { fileId: migrations.get(reveal.fileId) ?? reveal.fileId }
                    : {})
                }
              }
            : {})
        }
      })
      return result
    }
  }
}
