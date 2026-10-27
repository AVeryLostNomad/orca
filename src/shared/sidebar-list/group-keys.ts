import type { Worktree } from '../worktree/types'
import { getWorktreeHostIdentity } from '../worktree/host-qualified-identity'
import type { ProjectGroup } from '../project-group-types'
import {
  getProjectGroupExecutionHostId,
  getProjectGroupHostIdentity,
  UNGROUPED_PROJECT_GROUP_KEY
} from '../project-groups'

export {
  PR_GROUP_ORDER,
  getPRLaneKey,
  type PRGroupKey
} from '../workspace-view/workspace-pr-groups'

// Why host-qualified for remote groups: the same group id can exist on several hosts.
export function getProjectGroupHeaderKey(
  group: Pick<ProjectGroup, 'id' | 'connectionId' | 'executionHostId'> | null
): string {
  if (!group) {
    return UNGROUPED_PROJECT_GROUP_KEY
  }
  return `project-group:${
    getProjectGroupExecutionHostId(group) === 'local'
      ? group.id
      : getProjectGroupHostIdentity(group)
  }`
}

export const PINNED_GROUP_KEY = 'pinned'

export const ALL_GROUP_KEY = 'all'

export const LINEAGE_GROUP_PREFIX = 'lineage:'

export function getLineageGroupKey(worktreeId: string): string {
  return `${LINEAGE_GROUP_PREFIX}${worktreeId}`
}

export function getWorktreeLineageGroupKey(worktree: Pick<Worktree, 'id' | 'hostId'>): string {
  return getLineageGroupKey(worktree.hostId ? getWorktreeHostIdentity(worktree) : worktree.id)
}
