import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import {
  projectGroupMatchesOwnerHost,
  resolveProjectGroupOwnerHostId,
  runtimeTargetForProjectGroupOwner
} from '../slices/project-group-owner-routing'
import { callRuntimeRpc } from '../../runtime/runtime-rpc-client'
import { getRuntimeTargetHostId } from '../../runtime/runtime-client-target'
import { claimHostCatalogFence } from '../host-catalog-fencing'
import type { RepoSlice } from '../repos/repo-state'
import { applyProjectGroupDeleteCascade } from './project-group-removal-state'
import { getProjectGroupUpdateIdentity } from './project-group-catalog'
import { getProjectGroupUpdateCoordinator } from './project-group-update-coordinator'
import { adoptFromEndpoint } from '../adopt-from-endpoint'

/** Owner-routed group update/delete, coordinated so a slower write cannot revert a newer one. */
export function createProjectGroupOwnerWrites(
  set: Parameters<StateCreator<AppState>>[0],
  get: Parameters<StateCreator<AppState>>[1]
): Pick<RepoSlice, 'updateProjectGroup' | 'deleteProjectGroup'> {
  return {
    updateProjectGroup: async (groupId, updates, options) => {
      // Why: the sidebar lists groups from every host, so the mutation follows the group's owner, not the focused host.
      const ownerHostId = resolveProjectGroupOwnerHostId(get(), groupId, options?.hostId)
      const target = runtimeTargetForProjectGroupOwner(get(), groupId, options?.hostId)
      if (!target) {
        return false
      }
      const updateIdentity = getProjectGroupUpdateIdentity(
        ownerHostId ?? getRuntimeTargetHostId(target),
        groupId
      )
      const projectGroupUpdates = getProjectGroupUpdateCoordinator(get)
      const ticket = projectGroupUpdates.begin(updateIdentity, Object.keys(updates))
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
        // Why: invalidate catalog loads started before this write so they cannot revert it.
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
        const ownedGroup = adoptFromEndpoint(target, { kind: 'projectGroup', row: updated })
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
      const target = runtimeTargetForProjectGroupOwner(get(), groupId, options?.hostId)
      if (!target) {
        return false
      }
      const updateIdentity = getProjectGroupUpdateIdentity(
        ownerHostId ?? getRuntimeTargetHostId(target),
        groupId
      )
      const projectGroupUpdates = getProjectGroupUpdateCoordinator(get)
      const ticket = projectGroupUpdates.begin(updateIdentity, ['delete'], true)
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
    }
  }
}
