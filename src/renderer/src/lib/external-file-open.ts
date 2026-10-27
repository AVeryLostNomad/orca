import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { captureEditorFileDropOpen } from '@/components/editor/editor-dropped-file-open'

export { getEditorFileDropOperationContext } from '@/components/editor/editor-dropped-file-open'

/**
 * Opens OS "open with" paths as editor tabs in the active workspace. Reuses the editor drop
 * pipeline, which uploads into remote-owned workspaces and refuses host changes mid-open.
 */
export function openExternalPathsInActiveWorkspace(
  paths: string[],
  options?: { notifyWhenNoWorkspace?: boolean }
): void {
  if (paths.length === 0) {
    return
  }
  const activeWorktreeId = useAppStore.getState().activeWorktreeId
  if (!activeWorktreeId) {
    if (options?.notifyWhenNoWorkspace) {
      toast.error(
        translate(
          'auto.lib.externalFileOpen.noActiveWorkspace',
          'Open a workspace in Orca first, then open the file again.'
        )
      )
    }
    return
  }
  void captureEditorFileDropOpen({ worktreeId: activeWorktreeId })(paths)
}
