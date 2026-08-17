import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import type { WorkspaceSessionSnapshot } from './workspace-session'

export function buildDataStudioSessionData(
  snapshot: WorkspaceSessionSnapshot
): Pick<WorkspaceSessionState, 'dataStudioTabsByWorktree' | 'activeDataStudioTabIdByWorktree'> {
  return {
    dataStudioTabsByWorktree: snapshot.dataStudioTabsByWorktree,
    activeDataStudioTabIdByWorktree: snapshot.activeDataStudioTabIdByWorktree
  }
}
