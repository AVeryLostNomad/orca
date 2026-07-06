import type { WorkspaceSessionState } from '../../../shared/types'
import type { WorkspaceSessionSnapshot } from './workspace-session'

export function buildCodeServerSessionData(
  snapshot: WorkspaceSessionSnapshot
): Pick<WorkspaceSessionState, 'codeServerTabsByWorktree' | 'activeCodeServerTabIdByWorktree'> {
  return {
    codeServerTabsByWorktree: snapshot.codeServerTabsByWorktree,
    activeCodeServerTabIdByWorktree: snapshot.activeCodeServerTabIdByWorktree
  }
}
