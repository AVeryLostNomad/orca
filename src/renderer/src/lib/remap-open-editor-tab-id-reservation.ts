import type { AppState } from '@/store'
import { buildOwnedEditorFileId, resolveEditorFileIdForOwner } from '@/store/slices/editor'

type RemappedEditorFile = {
  worktreeId: string
  runtimeEnvironmentId?: string | null
}

type ReserveRemappedEditorFileIdOptions = {
  state: AppState
  updatedPath: string
  file: RemappedEditorFile
  plainPathOwner: Map<string, string>
}

export function reserveRemappedEditorFileId({
  state,
  updatedPath,
  file,
  plainPathOwner
}: ReserveRemappedEditorFileIdOptions): string {
  const ownerKey = `${file.worktreeId}::${file.runtimeEnvironmentId?.trim() || ''}`
  const claimed = plainPathOwner.get(updatedPath)
  if (claimed === ownerKey) {
    return updatedPath
  }
  if (claimed !== undefined) {
    return buildOwnedEditorFileId(updatedPath, file.worktreeId, file.runtimeEnvironmentId)
  }
  const id = resolveEditorFileIdForOwner(
    state,
    updatedPath,
    file.worktreeId,
    file.runtimeEnvironmentId,
    ['edit']
  )
  if (id === updatedPath) {
    plainPathOwner.set(updatedPath, ownerKey)
  }
  return id
}
