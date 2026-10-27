import type { PersistedState } from '../../../shared/persisted-state-types'
import type { ProjectGroup } from '../../../shared/project-group-types'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import {
  createProjectGroup,
  getProjectGroupExecutionHostId,
  getProjectGroupSubtreeIds,
  normalizeProjectGroupName
} from '../../../shared/project-groups'
import { sanitizeRepoIcon } from '../../../shared/repo-icon'
import { getRepoExecutionHostId } from '../../../shared/execution-host'
import {
  PROJECT_ACCOUNT_PIN_FIELDS,
  type ProjectAccountPinField,
  type ProjectAccountPins
} from '../../../shared/project-account-pin-types'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import { projectGroupWorkspaceKey } from '../../../shared/project-group-workspace'
import { removeWorkspaceSessionOwnersEverywhere } from '../restoring-sessions/session-owner-removal'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Cheap presence check over owner-keyed maps and owner-tagged rows. */
function sessionMentionsOwnerKey(
  session: WorkspaceSessionState | undefined,
  ownerKey: string
): boolean {
  if (!session) {
    return false
  }
  if (session.activeWorkspaceKey === ownerKey || session.activeWorktreeId === ownerKey) {
    return true
  }
  const values: unknown[] = Object.values(session)
  for (const value of values) {
    if (!value || typeof value !== 'object') {
      continue
    }
    if (Array.isArray(value)) {
      if (value.some((entry: unknown) => entry === ownerKey)) {
        return true
      }
      continue
    }
    if (ownerKey in value) {
      return true
    }
    const rows: unknown[] = Object.values(value)
    if (rows.some((row) => isRecord(row) && row.worktreeId === ownerKey)) {
      return true
    }
  }
  return false
}

export type ProjectGroupMutationOperations = {
  state: PersistedState
  scheduleSave: () => void
  removeWorkspaceLineageForFolderParent: (folderWorkspaceId: string) => void
  pruneMobileClientTabSelections: (matchesWorktreeId: (worktreeId: string) => boolean) => void
}

export class ProjectGroupPersistenceOperations {
  constructor(private readonly operations: ProjectGroupMutationOperations) {}

  private get state(): PersistedState {
    return this.operations.state
  }

  private scheduleSave(): void {
    this.operations.scheduleSave()
  }

  private removeWorkspaceLineageForFolderParent(folderWorkspaceId: string): void {
    this.operations.removeWorkspaceLineageForFolderParent(folderWorkspaceId)
  }

  private pruneMobileClientTabSelections(matchesWorktreeId: (worktreeId: string) => boolean): void {
    this.operations.pruneMobileClientTabSelections(matchesWorktreeId)
  }

  getProjectGroups(): ProjectGroup[] {
    return [...(this.state.projectGroups ?? [])].sort(
      (left, right) => left.tabOrder - right.tabOrder || left.name.localeCompare(right.name)
    )
  }

  createProjectGroup(input: {
    name: string
    parentPath?: string | null
    connectionId?: string | null
    parentGroupId?: string | null
    createdFrom: ProjectGroup['createdFrom']
  }): ProjectGroup {
    let maxOrder = -1
    // Large persisted lists can exceed spread argument limits.
    for (const existingGroup of this.state.projectGroups ?? []) {
      maxOrder = Math.max(maxOrder, existingGroup.tabOrder)
    }
    const group = createProjectGroup({
      ...input,
      tabOrder: maxOrder + 1
    })
    this.state.projectGroups = [...(this.state.projectGroups ?? []), group]
    this.scheduleSave()
    return group
  }

  updateProjectGroup(
    groupId: string,
    updates: Partial<Pick<ProjectGroup, 'name' | 'isCollapsed' | 'tabOrder' | 'color' | 'icon'>> &
      ProjectAccountPins
  ): ProjectGroup | null {
    const group = (this.state.projectGroups ?? []).find((entry) => entry.id === groupId)
    if (!group) {
      return null
    }
    if (updates.name !== undefined) {
      group.name = normalizeProjectGroupName(updates.name, group.name)
    }
    if (updates.isCollapsed !== undefined) {
      group.isCollapsed = updates.isCollapsed
    }
    if (updates.tabOrder !== undefined && Number.isFinite(updates.tabOrder)) {
      group.tabOrder = updates.tabOrder
    }
    if (updates.color !== undefined) {
      group.color = typeof updates.color === 'string' ? updates.color : null
    }
    if (updates.icon !== undefined) {
      group.icon = sanitizeRepoIcon(updates.icon) ?? null
    }
    for (const field of PROJECT_ACCOUNT_PIN_FIELDS) {
      if (!(field in updates)) {
        continue
      }
      const value = updates[field]
      if (typeof value === 'string' && value.trim()) {
        group[field] = value
      } else {
        delete group[field]
      }
    }
    group.updatedAt = Date.now()
    this.scheduleSave()
    return group
  }

  /** Clears `field` on every project and subgroup below `groupId` so they all inherit its value. */
  clearProjectGroupDescendantAccountPins(
    groupId: string,
    field: ProjectAccountPinField
  ): { clearedProjects: number; clearedGroups: number } | null {
    const rootGroup = (this.state.projectGroups ?? []).find((group) => group.id === groupId)
    if (!rootGroup) {
      return null
    }
    const hostId = getProjectGroupExecutionHostId(rootGroup)
    const subtreeIds = getProjectGroupSubtreeIds(this.state.projectGroups ?? [], groupId, hostId)
    let clearedGroups = 0
    for (const group of this.state.projectGroups ?? []) {
      if (
        group.id !== groupId &&
        subtreeIds.has(group.id) &&
        getProjectGroupExecutionHostId(group) === hostId &&
        group[field]
      ) {
        delete group[field]
        group.updatedAt = Date.now()
        clearedGroups += 1
      }
    }
    let clearedProjects = 0
    this.state.repos = this.state.repos.map((repo) => {
      if (
        !repo.projectGroupId ||
        !subtreeIds.has(repo.projectGroupId) ||
        getRepoExecutionHostId(repo) !== hostId ||
        !repo[field]
      ) {
        return repo
      }
      clearedProjects += 1
      const next = { ...repo }
      delete next[field]
      return next
    })
    if (clearedGroups > 0 || clearedProjects > 0) {
      this.scheduleSave()
    }
    return { clearedProjects, clearedGroups }
  }

  deleteProjectGroup(groupId: string): boolean {
    const before = this.state.projectGroups?.length ?? 0
    const rootGroup = (this.state.projectGroups ?? []).find((group) => group.id === groupId)
    const deletedGroupIds = getProjectGroupSubtreeIds(
      this.state.projectGroups ?? [],
      groupId,
      rootGroup ? getProjectGroupExecutionHostId(rootGroup) : 'local'
    )
    this.state.projectGroups = (this.state.projectGroups ?? []).filter(
      (group) => !deletedGroupIds.has(group.id)
    )
    if ((this.state.projectGroups?.length ?? 0) === before) {
      return false
    }
    // Sidebar grouping does not own repos; ungroup them rather than delete them.
    this.state.repos = this.state.repos.map((repo) =>
      repo.projectGroupId && deletedGroupIds.has(repo.projectGroupId)
        ? { ...repo, projectGroupId: null }
        : repo
    )
    // Group-wide workspaces are derived from the group, so their sessions go with it.
    const sessions = [
      this.state.workspaceSession,
      ...Object.values(this.state.workspaceSessionsByHostId ?? {})
    ]
    const removedFolderWorkspaceKeys = new Set(
      [...deletedGroupIds]
        .map((id) => projectGroupWorkspaceKey(id))
        // Skip the clone-and-prune pass when no session ever opened the group workspace.
        .filter((key) => sessions.some((session) => sessionMentionsOwnerKey(session, key)))
    )
    for (const workspace of this.state.folderWorkspaces ?? []) {
      if (deletedGroupIds.has(workspace.projectGroupId)) {
        removedFolderWorkspaceKeys.add(folderWorkspaceKey(workspace.id))
        this.removeWorkspaceLineageForFolderParent(workspace.id)
      }
    }
    // Remove all partition copies or folder layouts could resurrect on load.
    removeWorkspaceSessionOwnersEverywhere(this.state, removedFolderWorkspaceKeys)
    this.state.folderWorkspaces = (this.state.folderWorkspaces ?? []).filter(
      (workspace) => !deletedGroupIds.has(workspace.projectGroupId)
    )
    this.pruneMobileClientTabSelections((worktreeId) => removedFolderWorkspaceKeys.has(worktreeId))
    this.scheduleSave()
    return true
  }
}
