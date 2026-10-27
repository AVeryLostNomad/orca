import type { EditorGet, EditorSet } from '../types/editor-set-get'
import type { EditorSlice } from '../types/editor-slice'
import { addAdditionalValidWorkspaceKeys } from '@/lib/workspace-session-hydration-keys'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../../../shared/constants'
import { folderWorkspaceKey } from '../../../../../../shared/workspace-scope'
import { buildValidWorktreeIdsForSessionHydration } from '../../../../../../shared/worktree/degraded-repo-worktree-validity'
import { migrateHydratedEditorTabsAndGroups } from '../file-ids/hydrated-editor-file-ids'
import { buildHydratedEditorSessionState } from './hydrated-editor-session-state'
import { buildHydratedWorkingDocument } from './hydrated-working-document'
import { selectFolderWorkspaces } from '../../../workspace-record-selectors'

export function createHydrateEditorSession(
  set: EditorSet,
  get: EditorGet
): Pick<EditorSlice, 'hydrateEditorSession'> {
  return {
    hydrateEditorSession: (session, options) => {
      set((s) => {
        const validWorktreeIds = buildValidWorktreeIdsForSessionHydration(
          s,
          Object.keys(session.openFilesByWorktree ?? {})
        )
        validWorktreeIds.add(FLOATING_TERMINAL_WORKTREE_ID)
        for (const workspace of selectFolderWorkspaces(s)) {
          validWorktreeIds.add(folderWorkspaceKey(workspace.id))
        }
        addAdditionalValidWorkspaceKeys(validWorktreeIds, options)

        const { state, editorFileIdMigrationsByWorktree } = buildHydratedEditorSessionState(
          session,
          validWorktreeIds,
          // Why: use the store's activeWorktreeId — hydrateWorkspaceSession may have nulled an invalid ID, and we must respect that.
          s.activeWorktreeId,
          (file, persisted) => buildHydratedWorkingDocument(s, file, persisted)
        )
        return {
          ...state,
          ...migrateHydratedEditorTabsAndGroups(s, editorFileIdMigrationsByWorktree)
        }
      })
      // A restored dirty document must stay reachable from a visible tab, or its recovery text is unclosable.
      const memberships = { ...get().workingDocumentIdsByTab }
      let recoveredMemberships = false
      for (const file of get().openFiles) {
        const documentIds = memberships[file.id]
        if (!file.isDirty || !documentIds?.length) {
          continue
        }
        let tabs = (get().unifiedTabsByWorktree[file.worktreeId] ?? []).filter(
          (tab) => tab.contentType === 'editor' && tab.entityId === file.id
        )
        if (tabs.length === 0) {
          tabs = [
            get().createUnifiedTab(file.worktreeId, 'editor', {
              entityId: file.id,
              label: file.relativePath,
              isPreview: false,
              activate: false,
              recordInteraction: false
            })
          ]
        }
        for (const tab of tabs) {
          memberships[tab.id] = documentIds
        }
        if (!tabs.some((tab) => tab.id === file.id)) {
          delete memberships[file.id]
        }
        recoveredMemberships = true
      }
      if (recoveredMemberships) {
        set({ workingDocumentIdsByTab: memberships })
      }
    }
  }
}
