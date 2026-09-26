import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { statRuntimePath } from '@/runtime/runtime-file-metadata-client'
import { isDefinitiveAbsence } from '../../../shared/definitive-filesystem-absence'
import { detectLanguage } from './language-detect'
import { joinPath } from './path'
import {
  assertEditorFileOperationCurrent,
  captureEditorFileOperationProvenance,
  getEditorFileOperationContext
} from './editor-file-operation-owner'

export async function openReviewWorkingFile({
  worktreeId,
  worktreePath,
  relativePath,
  targetGroupId,
  preview = false
}: {
  worktreeId: string
  worktreePath: string
  relativePath: string
  targetGroupId?: string
  preview?: boolean
}): Promise<string | null> {
  const state = useAppStore.getState()
  const filePath = joinPath(worktreePath, relativePath)
  try {
    const operationProvenance = captureEditorFileOperationProvenance(
      state,
      worktreeId,
      undefined,
      false
    )
    const context = getEditorFileOperationContext(
      state,
      { worktreeId, operationProvenance },
      worktreePath
    )
    const conflict = state.gitStatusByWorktree[worktreeId]?.find(
      (entry) => entry.path === relativePath && entry.conflictKind && entry.conflictStatus
    )
    if (conflict?.conflictKind && conflict.conflictStatus) {
      if (conflict.conflictStatus === 'unresolved') {
        state.trackConflictPath(worktreeId, relativePath, conflict.conflictKind)
      }
      state.openConflictFile(worktreeId, worktreePath, conflict, detectLanguage(relativePath), {
        targetGroupId,
        preview
      })
      return null
    }
    try {
      if ((await statRuntimePath(context, filePath)).isDirectory) {
        return null
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Electron drops errno fields but preserves the leading errno behind its IPC wrapper.
      const code =
        /^(?:(?:Error invoking remote method '[^']+':|Error:)\s*)*(E[A-Z]+)(?=:|\s|$)/.exec(
          message
        )?.[1]
      if (isDefinitiveAbsence(error) || isDefinitiveAbsence({ code })) {
        return null
      }
      // The normal loader owns permission/host errors; never turn them into absence.
    }
    const current = useAppStore.getState()
    const owner = assertEditorFileOperationCurrent(current, worktreeId, operationProvenance)
    const fileId = current.openFile(
      {
        worktreeId,
        filePath,
        relativePath,
        runtimeEnvironmentId: owner.runtimeEnvironmentId ?? undefined,
        operationProvenance,
        language: detectLanguage(relativePath),
        mode: 'edit'
      },
      { targetGroupId, preview, focusEditor: true, suppressActiveRuntimeFallback: true }
    )
    current.setEditorViewMode(fileId, 'edit')
    return fileId
  } catch (error) {
    toast.error(String(error))
    return null
  }
}
