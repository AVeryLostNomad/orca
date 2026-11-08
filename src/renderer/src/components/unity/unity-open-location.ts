import { detectLanguage } from '@/lib/language-detect'
import { useAppStore } from '@/store'
import { scheduleEditorLineReveal } from '@/store/slices/editor/focus/editor-focus-reveal'
import { relativePathInsideRoot } from '../../../../shared/cross-platform-path'
import { resolveLocalUnityWorkspaceRoot } from './unity-workbench-store'

/** Opens a Unity-reported absolute path in the active local workspace's editor, revealing its line. */
export function openUnityFileLocation(filePath: string, line: number | undefined): void {
  const store = useAppStore.getState()
  const worktreeId = store.activeWorktreeId
  const workspaceRoot = resolveLocalUnityWorkspaceRoot(worktreeId)
  if (!worktreeId || !workspaceRoot) {
    return
  }
  const fileId = store.openFile({
    filePath,
    // Package sources live outside the workspace; their tabs carry the absolute path like quick-open does.
    relativePath: relativePathInsideRoot(workspaceRoot, filePath) ?? filePath,
    worktreeId,
    language: detectLanguage(filePath),
    mode: 'edit'
  })
  if (line !== undefined && line > 0) {
    scheduleEditorLineReveal(useAppStore.getState, filePath, line, 1, fileId)
  }
}
