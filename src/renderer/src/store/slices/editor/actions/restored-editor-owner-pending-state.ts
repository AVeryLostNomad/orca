import type { AppState } from '../../../types'

type PendingEditorState = Pick<
  AppState,
  'pendingEditorReveal' | 'pendingEditorFocusRequest' | 'pendingExplorerReveal'
>

export function migrateRestoredEditorPendingState(
  state: PendingEditorState,
  migrations: ReadonlyMap<string, string>,
  sourceFilePath: string,
  sourceWorktreeId: string,
  targetWorktreeId: string
): Partial<PendingEditorState> {
  return {
    ...(state.pendingEditorReveal?.fileId && migrations.has(state.pendingEditorReveal.fileId)
      ? {
          pendingEditorReveal: {
            ...state.pendingEditorReveal,
            fileId: migrations.get(state.pendingEditorReveal.fileId)!,
            filePath: sourceFilePath
          }
        }
      : {}),
    ...(state.pendingEditorFocusRequest?.fileId &&
    migrations.has(state.pendingEditorFocusRequest.fileId)
      ? {
          pendingEditorFocusRequest: {
            ...state.pendingEditorFocusRequest,
            fileId: migrations.get(state.pendingEditorFocusRequest.fileId)!,
            worktreeId: targetWorktreeId
          }
        }
      : {}),
    ...(state.pendingExplorerReveal?.filePath === sourceFilePath &&
    state.pendingExplorerReveal.worktreeId === sourceWorktreeId
      ? {
          pendingExplorerReveal: {
            ...state.pendingExplorerReveal,
            worktreeId: targetWorktreeId
          }
        }
      : {})
  }
}
