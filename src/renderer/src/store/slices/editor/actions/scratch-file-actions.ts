import { toast } from 'sonner'
import type { EditorGet, EditorSet } from '../types/editor-set-get'
import type { EditorSlice } from '../types/editor-slice'
import { extractIpcErrorMessage } from '@/lib/ipc-error'
import { createScratchFile } from '@/lib/create-scratch-file'

export function createScratchFileActions(
  _set: EditorSet,
  get: EditorGet
): Pick<EditorSlice, 'openNewScratchFileInActiveWorkspace'> {
  return {
    openNewScratchFileInActiveWorkspace: async (groupId) => {
      const worktreeId = get().activeWorktreeId
      if (!worktreeId) {
        return
      }
      try {
        const fileInfo = await createScratchFile(worktreeId)
        if (!fileInfo) {
          return
        }
        get().openFile(fileInfo, { preview: false, targetGroupId: groupId })
      } catch (err) {
        toast.error(extractIpcErrorMessage(err, 'Failed to create scratch file.'))
      }
    }
  }
}
