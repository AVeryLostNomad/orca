import type { AppState } from '@/store/types'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { getRelativePathInsideRoot } from '@/lib/path'
import type { OpenFile } from '@/store/slices/editor'

export function isAbsolutePathLike(value: string): boolean {
  return value.startsWith('/') || value.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(value)
}

export function canUseChangesModeForFile(file: OpenFile): boolean {
  return (
    file.mode === 'edit' &&
    !file.isUntitled &&
    file.relativePath !== file.filePath &&
    !isAbsolutePathLike(file.relativePath)
  )
}

export function getEditorGitBaselineScope(
  state: Pick<AppState, 'worktreesByRepo' | 'repos'>,
  file: OpenFile
): string | null {
  if (!canUseChangesModeForFile(file) || file.liveTail || file.readOnly) {
    return null
  }
  const worktree = findWorktreeById(state.worktreesByRepo, file.worktreeId)
  if (!worktree) {
    return null
  }
  const repo = state.repos.find((candidate) => candidate.id === worktree.repoId)
  if (!repo || repo.kind === 'folder') {
    return null
  }
  if (getRelativePathInsideRoot(file.filePath, worktree.path) !== file.relativePath) {
    return null
  }
  return JSON.stringify([
    repo.executionHostId,
    repo.connectionId,
    file.runtimeEnvironmentId,
    worktree.id,
    file.filePath,
    worktree.head
  ])
}
