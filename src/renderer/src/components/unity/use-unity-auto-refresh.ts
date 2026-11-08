import { useEffect } from 'react'
import { useAppStore } from '@/store'
import {
  ORCA_EDITOR_DOCUMENT_SAVED_EVENT,
  type EditorDocumentSavedDetail
} from '@/components/editor/editor-autosave'
import {
  ORCA_WORKTREE_FILE_CHANGE_EVENT,
  isWorktreeCatchUpPayload
} from '@/hooks/worktree-file-change-event'
import type { FsChangeEvent } from '../../../../shared/filesystem-entry-types'
import { isLocalExecutionHost } from '../../../../shared/execution-host'
import { relativePathInsideRoot } from '../../../../shared/cross-platform-path'
import {
  getUnityEditorStateSnapshot,
  isUnityIntegrationEnabled,
  loadUnityProjectRoots,
  refreshUnityEditorState,
  resolveLocalUnityWorkspaceRoot
} from './unity-workbench-store'
import { reportUnityCompileErrors } from './unity-editor-commands'

export const UNITY_AUTO_REFRESH_DEBOUNCE_MS = 750

/** Unity root whose Assets/ or Packages/ holds the path; edits elsewhere never change the asset database. */
export function unityRefreshRootFor(roots: readonly string[], path: string): string | null {
  for (const root of roots) {
    const topSegment = relativePathInsideRoot(root, path)?.split(/[\\/]/)[0]
    if (topSegment === 'Assets' || topSegment === 'Packages') {
      return root
    }
  }
  return null
}

/** Coalesces bursts of saves into one refresh per project after the burst settles. */
export function createUnityRefreshDebouncer(
  run: (projectRoot: string) => void,
  delayMs: number = UNITY_AUTO_REFRESH_DEBOUNCE_MS
): { schedule: (projectRoot: string) => void; dispose: () => void } {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  return {
    schedule: (projectRoot) => {
      clearTimeout(timers.get(projectRoot))
      timers.set(
        projectRoot,
        setTimeout(() => {
          timers.delete(projectRoot)
          run(projectRoot)
        }, delayMs)
      )
    },
    dispose: () => {
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
      timers.clear()
    }
  }
}

async function refreshConnectedUnityEditor(projectRoot: string): Promise<void> {
  const editorState =
    getUnityEditorStateSnapshot(projectRoot) ?? (await refreshUnityEditorState(projectRoot))
  if (!editorState?.connected) {
    return
  }
  // Background refreshes stay silent on failure; only compile errors are worth interrupting for.
  const result = await window.api?.unity
    ?.runEditorAction({ projectRoot, action: 'refresh' })
    .catch(() => null)
  if (result) {
    reportUnityCompileErrors(result)
  }
}

function isAutoRefreshEnabled(): boolean {
  const settings = useAppStore.getState().settings
  return isUnityIntegrationEnabled(settings) && settings?.unityAutoRefreshOnSave !== false
}

function isScriptStructureChange(event: FsChangeEvent): boolean {
  if (event.kind !== 'create' && event.kind !== 'delete' && event.kind !== 'rename') {
    return false
  }
  // A moved or deleted folder may carry scripts; its children are not reported individually.
  if (event.isDirectory) {
    return event.kind !== 'create'
  }
  return [event.absolutePath, event.oldAbsolutePath].some((path) =>
    path?.toLowerCase().endsWith('.cs')
  )
}

/** App-wide: refreshes the connected Unity editor after local saves and script create/delete/rename. */
export function useUnityAutoRefresh(): void {
  useEffect(() => {
    const debouncer = createUnityRefreshDebouncer((projectRoot) => {
      void refreshConnectedUnityEditor(projectRoot)
    })
    const scheduleForPaths = async (workspaceRoot: string, paths: string[]): Promise<void> => {
      const roots = await loadUnityProjectRoots(workspaceRoot)
      for (const path of paths) {
        const projectRoot = unityRefreshRootFor(roots, path)
        if (projectRoot) {
          debouncer.schedule(projectRoot)
        }
      }
    }

    const onSaved = (event: Event): void => {
      // SAFETY: editor-document-write dispatches this event only with EditorDocumentSavedDetail.
      const detail = (event as CustomEvent<EditorDocumentSavedDetail>).detail
      if (
        !isLocalExecutionHost(detail.owner.executionHostId) ||
        detail.owner.runtimeEnvironmentId !== null ||
        !isAutoRefreshEnabled()
      ) {
        return
      }
      const state = useAppStore.getState()
      const worktreeId =
        state.workingDocuments[detail.documentId]?.target.worktreeId ?? state.activeWorktreeId
      const workspaceRoot = resolveLocalUnityWorkspaceRoot(worktreeId)
      if (workspaceRoot) {
        void scheduleForPaths(workspaceRoot, [detail.filePath])
      }
    }

    const onFileChange = (event: WindowEventMap['orca:worktree-file-change']): void => {
      const { payload, runtimeEnvironmentId } = event.detail
      if (
        payload.connectionId ||
        runtimeEnvironmentId !== null ||
        payload.resync ||
        isWorktreeCatchUpPayload(payload) ||
        !isAutoRefreshEnabled()
      ) {
        return
      }
      const paths = payload.events
        .filter(isScriptStructureChange)
        .map((change) => change.absolutePath)
      if (paths.length > 0) {
        void scheduleForPaths(payload.worktreePath, paths)
      }
    }

    window.addEventListener(ORCA_EDITOR_DOCUMENT_SAVED_EVENT, onSaved)
    window.addEventListener(ORCA_WORKTREE_FILE_CHANGE_EVENT, onFileChange)
    return () => {
      window.removeEventListener(ORCA_EDITOR_DOCUMENT_SAVED_EVENT, onSaved)
      window.removeEventListener(ORCA_WORKTREE_FILE_CHANGE_EVENT, onFileChange)
      debouncer.dispose()
    }
  }, [])
}
