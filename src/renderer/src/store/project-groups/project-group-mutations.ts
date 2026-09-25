import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import { selectProjectGroupRemovalTargets } from '../slices/project-group-removal-targets'
import {
  catalogOwnsHost,
  projectGroupMatchesOwnerHost,
  resolveProjectGroupOwnerHostId,
  settingsForProjectGroupOwner
} from '../slices/project-group-owner-routing'
import { findRepoForHost, repoMatchesHostIdentity } from '../slices/repo-host-identity'
import { callRuntimeRpc, getActiveRuntimeTarget } from '../../runtime/runtime-rpc-client'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import { getRuntimeTargetHostId } from '../runtime-target-host'
import { claimHostCatalogFence, isHostCatalogFenceTargetCurrent } from '../host-catalog-fencing'
import type { ProjectRemovalFailure, RepoSlice } from '../repos/repo-state'
import { mergeProjectCompatibilityForHostRepoChange } from '../repos/repo-catalog-identity'
import { applyProjectGroupDeleteCascade } from './project-group-removal-state'
import { repoWithFetchedOwner, settingsForRepoOwner } from '../repos/owner-routing'
import { projectGroupWithFetchedOwner } from './project-group-owner-stamping'
import { getProjectGroupUpdateIdentity } from './project-group-catalog'
import { getProjectGroupUpdateCoordinator } from './project-group-update-coordinator'

export function createProjectGroupMutationActions(
  set: Parameters<StateCreator<AppState>>[0],
  get: Parameters<StateCreator<AppState>>[1]
): Pick<
  RepoSlice,
  | 'updateProjectGroup'
  | 'deleteProjectGroup'
  | 'deleteProjectGroupWithContainedProjects'
  | 'moveProjectToGroup'
> {
  return {
    updateProjectGroup: async (groupId, updates, options) => {
      // Why: the sidebar lists groups from every host, so the mutation follows the group's owner, not the focused host.
      const ownerHostId = resolveProjectGroupOwnerHostId(get(), groupId, options?.hostId)
      const target = getActiveRuntimeTarget(
        settingsForProjectGroupOwner(get(), groupId, options?.hostId)
      )
      const updateIdentity = getProjectGroupUpdateIdentity(
        ownerHostId ?? getRuntimeTargetHostId(target),
        groupId
      )
      const projectGroupUpdates = getProjectGroupUpdateCoordinator(get)
      const ticket = projectGroupUpdates.begin(updateIdentity, Object.keys(updates))
      const mutationFence = claimHostCatalogFence(get, 'project-groups', target)
      try {
        const updated =
          target.kind === 'local'
            ? await window.api.projectGroups.update({ groupId, updates })
            : (
                await callRuntimeRpc<{ group: ProjectGroup | null }>(
                  target,
                  'projectGroup.update',
                  { groupId, updates },
                  { timeoutMs: 15_000 }
                )
              ).group
        if (!updated) {
          return false
        }
        if (!isHostCatalogFenceTargetCurrent(get, mutationFence)) {
          return true
        }
        claimHostCatalogFence(get, 'project-groups', target)
        const latestFields = projectGroupUpdates.latestFields(
          updateIdentity,
          ticket
        ) as (keyof typeof updates)[]
        if (
          latestFields.length === 0 ||
          projectGroupUpdates.hasLaterDeletion(updateIdentity, ticket)
        ) {
          return true
        }
        const ownedGroup = projectGroupWithFetchedOwner(updated, target)
        set((s) => {
          let changed = false
          const projectGroups = s.projectGroups.map((group) => {
            if (!projectGroupMatchesOwnerHost(group, groupId, ownerHostId)) {
              return group
            }
            const next = { ...group }
            for (const field of latestFields) {
              Object.assign(next, { [field]: ownedGroup[field] })
            }
            next.updatedAt = Math.max(group.updatedAt, ownedGroup.updatedAt)
            changed = true
            return next
          })
          return changed ? { projectGroups, folderWorkspacePathStatuses: {} } : s
        })
        return true
      } catch (err) {
        console.error('Failed to update project group:', err)
        return false
      } finally {
        projectGroupUpdates.finish(updateIdentity, ticket)
      }
    },

    deleteProjectGroup: async (groupId, options) => {
      // Why: deletion targets the group's owner host (see updateProjectGroup); focus may be elsewhere.
      const ownerHostId = resolveProjectGroupOwnerHostId(get(), groupId, options?.hostId)
      const target = getActiveRuntimeTarget(
        settingsForProjectGroupOwner(get(), groupId, options?.hostId)
      )
      const updateIdentity = getProjectGroupUpdateIdentity(
        ownerHostId ?? getRuntimeTargetHostId(target),
        groupId
      )
      const projectGroupUpdates = getProjectGroupUpdateCoordinator(get)
      const ticket = projectGroupUpdates.begin(updateIdentity, ['delete'], true)
      const mutationFence = claimHostCatalogFence(get, 'project-groups', target)
      try {
        const deleted =
          target.kind === 'local'
            ? await window.api.projectGroups.delete({ groupId })
            : (
                await callRuntimeRpc<{ deleted: boolean }>(
                  target,
                  'projectGroup.delete',
                  { groupId },
                  { timeoutMs: 15_000 }
                )
              ).deleted
        if (!deleted) {
          return false
        }
        if (!isHostCatalogFenceTargetCurrent(get, mutationFence)) {
          return true
        }
        claimHostCatalogFence(get, 'project-groups', target)
        if (projectGroupUpdates.isLatestMutation(updateIdentity, ticket)) {
          set((s) => applyProjectGroupDeleteCascade(s, groupId, ownerHostId))
        }
        return true
      } catch (err) {
        console.error('Failed to delete project group:', err)
        return false
      } finally {
        projectGroupUpdates.finish(updateIdentity, ticket)
      }
    },

    deleteProjectGroupWithContainedProjects: async (groupId, options) => {
      const ownerHostId = resolveProjectGroupOwnerHostId(get(), groupId, options.hostId)
      const targets = selectProjectGroupRemovalTargets(
        get().projectGroups,
        get().repos,
        groupId,
        ownerHostId
      )
      const requestedProjectIds = options.removeContainedProjects ? targets.projectIds : []
      if (!targets.groupExists) {
        return {
          status: 'missing-group',
          groupId,
          requestedProjectIds,
          removedProjectIds: [],
          failedProjectRemovals: []
        }
      }

      const deleted = await get().deleteProjectGroup(groupId, {
        hostId: ownerHostId ?? undefined
      })
      if (!deleted) {
        return {
          status: 'group-delete-failed',
          groupId,
          requestedProjectIds,
          removedProjectIds: [],
          failedProjectRemovals: []
        }
      }

      if (!options.removeContainedProjects) {
        return {
          status: 'deleted-group',
          groupId,
          requestedProjectIds,
          removedProjectIds: [],
          failedProjectRemovals: []
        }
      }

      const removedProjectIds: string[] = []
      const failedProjectRemovals: ProjectRemovalFailure[] = []
      // Why: the group's catalog can hold rows from several hosts (a local catalog also owns SSH rows),
      // so each project is removed on its own host rather than on the group's.
      const findOwnedProjects = (projectId: string): Repo[] =>
        get().repos.filter(
          (repo) =>
            repo.id === projectId &&
            (!ownerHostId || catalogOwnsHost(ownerHostId, getRepoExecutionHostId(repo)))
        )
      for (const projectId of targets.projectIds) {
        const ownedProjects = findOwnedProjects(projectId)
        const projectHostId =
          ownedProjects.length === 1 ? getRepoExecutionHostId(ownedProjects[0]) : undefined
        try {
          if (ownedProjects.length > 0) {
            await get().removeProject(projectId, { hostId: projectHostId })
          }
        } catch (err) {
          console.error('Failed to remove contained project:', err)
        }
        const stillExists = findOwnedProjects(projectId).length > 0
        if (stillExists) {
          failedProjectRemovals.push({
            projectId,
            reason: 'Project remained in Orca after removeProject completed.'
          })
        } else {
          removedProjectIds.push(projectId)
        }
      }

      return {
        status: 'deleted-group',
        groupId,
        requestedProjectIds,
        removedProjectIds,
        failedProjectRemovals
      }
    },

    moveProjectToGroup: async (projectId, groupId, order) => {
      try {
        if (!findRepoForHost(get().repos, projectId, { settings: get().settings })) {
          return false
        }
        const target = getActiveRuntimeTarget(settingsForRepoOwner(get(), projectId))
        const moved =
          target.kind === 'local'
            ? await window.api.projectGroups.moveProject({
                projectId,
                groupId,
                order
              })
            : (
                await callRuntimeRpc<{ repo: Repo | null }>(
                  target,
                  'projectGroup.moveProject',
                  { repo: projectId, groupId, order },
                  { timeoutMs: 15_000 }
                )
              ).repo
        if (!moved) {
          return false
        }
        const ownedMoved = repoWithFetchedOwner(moved, target)
        const movedHostId = getRepoExecutionHostId(ownedMoved)
        set((s) => {
          const nextRepos = s.repos.map((repo) =>
            repoMatchesHostIdentity(repo, projectId, movedHostId) ? ownedMoved : repo
          )
          return {
            repos: nextRepos,
            ...mergeProjectCompatibilityForHostRepoChange({
              previous: { projects: s.projects, projectHostSetups: s.projectHostSetups },
              nextRepos,
              hostId: movedHostId
            }),
            folderWorkspacePathStatuses: {}
          }
        })
        return true
      } catch (err) {
        console.error('Failed to move repo to group:', err)
        return false
      }
    }
  }
}
