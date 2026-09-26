import type { EditorGet, EditorSet } from '../types/editor-set-get'
import type { EditorSlice } from '../types/editor-slice'
import type { OpenFile } from '../types/open-file'

export function createOpenFileMutations(
  set: EditorSet,
  get: EditorGet
): Pick<EditorSlice, 'setActiveFile' | 'reorderFiles' | 'clearUntitled'> {
  return {
    setActiveFile: (fileId) => {
      set((s) => {
        const file = s.openFiles.find((f) => f.id === fileId)
        const worktreeId = file?.worktreeId
        return {
          activeFileId: fileId,
          activeFileIdByWorktree: worktreeId
            ? { ...s.activeFileIdByWorktree, [worktreeId]: fileId }
            : s.activeFileIdByWorktree
        }
      })
      const state = get()
      const worktreeId = state.activeWorktreeId
      if (!worktreeId) {
        return
      }
      const groupId =
        state.activeGroupIdByWorktree?.[worktreeId] ?? state.groupsByWorktree?.[worktreeId]?.[0]?.id
      if (!groupId) {
        return
      }
      const item =
        state.findTabForEntityInGroup?.(worktreeId, groupId, fileId, 'editor') ??
        state.findTabForEntityInGroup?.(worktreeId, groupId, fileId, 'diff') ??
        state.findTabForEntityInGroup?.(worktreeId, groupId, fileId, 'conflict-review')
      if (item) {
        state.activateTab?.(item.id)
      }
    },

    reorderFiles: (fileIds) =>
      set((s) => {
        const reorderedSet = new Set(fileIds)
        const byId = new Map(s.openFiles.map((f) => [f.id, f]))
        const reordered = fileIds.map((id) => byId.get(id)).filter(Boolean) as OpenFile[]
        // Replace the reordered subset in-place: keep other-worktree files at their positions
        const result: OpenFile[] = []
        let ri = 0
        for (const f of s.openFiles) {
          if (reorderedSet.has(f.id)) {
            result.push(reordered[ri++])
          } else {
            result.push(f)
          }
        }
        return { openFiles: result }
      }),

    clearUntitled: (fileId) =>
      set((s) => ({
        openFiles: s.openFiles.map((f) => (f.id === fileId ? { ...f, isUntitled: undefined } : f))
      }))
  }
}
