import {
  normalizeExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import { getProjectGroupExecutionHostId } from '../../../../shared/project-groups'

/**
 * Which host section a folder workspace's row belongs to.
 *
 * Single source of truth: header counting, host bucketing and reveal all resolve
 * the host through here. Two resolvers that drift is how folder workspaces went
 * missing from the sidebar in the first place (#15362).
 */
export function getFolderWorkspaceHostId(
  folderWorkspace: Pick<FolderWorkspace, 'connectionId' | 'executionHostId'>,
  projectGroup: Pick<ProjectGroup, 'connectionId' | 'executionHostId'>,
  defaultHostId: ExecutionHostId
): ExecutionHostId {
  const executionHostId = normalizeExecutionHostId(folderWorkspace.executionHostId)
  if (executionHostId) {
    return executionHostId
  }
  const projectGroupHostId = getProjectGroupExecutionHostId(projectGroup, defaultHostId)
  if (projectGroupHostId !== defaultHostId || !folderWorkspace.connectionId) {
    return projectGroupHostId
  }
  return toSshExecutionHostId(folderWorkspace.connectionId)
}
