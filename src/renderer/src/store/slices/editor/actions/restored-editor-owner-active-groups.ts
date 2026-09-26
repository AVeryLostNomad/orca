import type { AppState } from '../../../types'

export function migrateRestoredEditorActiveGroupIds(
  activeGroupIdByWorktree: AppState['activeGroupIdByWorktree'],
  sourceGroupIds: readonly string[],
  sourceWorktreeId: string,
  targetWorktreeId: string,
  targetGroupId: string
): AppState['activeGroupIdByWorktree'] {
  const nextActiveGroupIdByWorktree = { ...activeGroupIdByWorktree }
  if (sourceGroupIds.length > 0) {
    const previousActiveGroupId = nextActiveGroupIdByWorktree[sourceWorktreeId]
    nextActiveGroupIdByWorktree[sourceWorktreeId] = sourceGroupIds.includes(previousActiveGroupId)
      ? previousActiveGroupId
      : sourceGroupIds[0]
  } else {
    delete nextActiveGroupIdByWorktree[sourceWorktreeId]
  }
  nextActiveGroupIdByWorktree[targetWorktreeId] = targetGroupId
  return nextActiveGroupIdByWorktree
}
