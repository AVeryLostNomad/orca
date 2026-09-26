import type { EditorGet, EditorSet } from '../types/editor-set-get'
import type { EditorSlice } from '../types/editor-slice'
import type { RestoredEditorOwnerResult } from '../types/restored-editor-owner'
import { buildRestoredEditorOwnerTransition } from './restored-editor-owner-transition'
import { getWorkingDocumentId, getWorkingDocumentTarget } from '../working-document'

export function createRestoredEditorOwner(
  set: EditorSet,
  get: EditorGet
): Pick<EditorSlice, 'setRestoredEditorOwnerMigrationPending' | 'reparentRestoredEditorFileOwner'> {
  return {
    setRestoredEditorOwnerMigrationPending: (fileId, pending) => {
      let changed = false
      set((s) => {
        const file = s.openFiles.find((candidate) => candidate.id === fileId)
        const target = file && getWorkingDocumentTarget(file)
        const documentId = target && getWorkingDocumentId(target.owner, target.filePath)
        const document = documentId && s.workingDocuments[documentId]
        const next = pending || undefined
        if (!document || document.pendingOwnerMigration === next) {
          return s
        }
        changed = true
        return {
          workingDocuments: {
            ...s.workingDocuments,
            [documentId]: { ...document, pendingOwnerMigration: next }
          }
        }
      })
      return changed
    },

    reparentRestoredEditorFileOwner: (args) => {
      let result: RestoredEditorOwnerResult = { ok: false, reason: 'stale' }
      const projectReparent = buildRestoredEditorOwnerTransition(args, (next) => {
        result = next
      })
      const initialSource = get().openFiles.find((file) => file.id === args.fileId)
      const activatesTargetWorkspace = Boolean(
        initialSource &&
        get().activeWorktreeId === initialSource.worktreeId &&
        get().activeFileId === initialSource.id
      )
      if (activatesTargetWorkspace) {
        get().setActiveWorktree(args.targetWorktreeId, args.targetExecutionHostId, {
          stateTransition: projectReparent
        })
      } else {
        set((state) => projectReparent(state).patch)
      }
      return result
    }
  }
}
