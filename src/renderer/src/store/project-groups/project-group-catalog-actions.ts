import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import {
  callRuntimeRpc,
  getActiveRuntimeTarget,
  settingsForRuntimeOwner
} from '../../runtime/runtime-rpc-client'
import type { FetchedProjectGroupCatalog } from './project-group-catalog'
import type { HostCatalogFence } from '../host-catalog-fencing'
import type { RepoSlice } from '../repos/repo-state'
import { arrayElementsUnchanged } from '../catalog-identity'
import {
  claimHostCatalogFence,
  isHostCatalogFenceCurrent,
  isHostCatalogFenceTargetCurrent
} from '../host-catalog-fencing'
import {
  fetchProjectGroupCatalogForTarget,
  mergeFetchedProjectGroupCatalog
} from './project-group-catalog'
import { listRuntimeEnvironmentsForAllHostLoad } from '../runtime-catalog-hosts'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import { getProjectGroupHostIdentity } from '../../../../shared/project-groups'
import { projectGroupWithFetchedOwner } from './project-group-owner-stamping'

export function createProjectGroupCatalogActions(
  set: Parameters<StateCreator<AppState>>[0],
  get: Parameters<StateCreator<AppState>>[1]
): Pick<RepoSlice, 'createProjectGroup' | 'fetchProjectGroups' | 'fetchProjectGroupsForAllHosts'> {
  return {
    createProjectGroup: async (name) => {
      try {
        const target = getActiveRuntimeTarget(get().settings)
        const mutationFence = claimHostCatalogFence(get, 'project-groups', target)
        const group =
          target.kind === 'local'
            ? await window.api.projectGroups.create({
                name,
                createdFrom: 'manual'
              })
            : (
                await callRuntimeRpc<{ group: ProjectGroup }>(
                  target,
                  'projectGroup.create',
                  { name, createdFrom: 'manual' },
                  { timeoutMs: 15_000 }
                )
              ).group
        const ownedGroup = projectGroupWithFetchedOwner(group, target)
        if (!isHostCatalogFenceTargetCurrent(get, mutationFence)) {
          return ownedGroup
        }
        claimHostCatalogFence(get, 'project-groups', target)
        set((s) => {
          if (
            s.projectGroups.some(
              (current) =>
                getProjectGroupHostIdentity(current) === getProjectGroupHostIdentity(ownedGroup)
            )
          ) {
            return s
          }
          return {
            projectGroups: [...s.projectGroups, ownedGroup],
            folderWorkspacePathStatuses: {}
          }
        })
        return ownedGroup
      } catch (err) {
        console.error('Failed to create project group:', err)
        return null
      }
    },
    fetchProjectGroups: async (options) => {
      try {
        const target = getActiveRuntimeTarget(
          settingsForRuntimeOwner(get().settings, options?.runtimeEnvironmentId)
        )
        const fence = claimHostCatalogFence(get, 'project-groups', target)
        const catalog = await fetchProjectGroupCatalogForTarget(target)
        if (!isHostCatalogFenceCurrent(get, fence)) {
          return
        }
        set((current) => {
          if (!isHostCatalogFenceCurrent(get, fence)) {
            return current
          }
          const { projectGroups } = mergeFetchedProjectGroupCatalog(catalog, current.projectGroups)
          return {
            projectGroups,
            ...(arrayElementsUnchanged(projectGroups, current.projectGroups)
              ? {}
              : { folderWorkspacePathStatuses: {} })
          }
        })
      } catch (err) {
        console.error('Failed to fetch project groups:', err)
      }
    },

    fetchProjectGroupsForAllHosts: async (options) => {
      // Why: startup renders an all-host sidebar; replacing groups with only the active host leaves other hosts' repos visible but ungrouped.
      const applyCatalog = (catalog: FetchedProjectGroupCatalog, fence: HostCatalogFence): void => {
        if (!isHostCatalogFenceCurrent(get, fence)) {
          return
        }
        set((s) => {
          if (!isHostCatalogFenceCurrent(get, fence)) {
            return s
          }
          const { projectGroups } = mergeFetchedProjectGroupCatalog(catalog, s.projectGroups)
          return {
            projectGroups,
            ...(arrayElementsUnchanged(projectGroups, s.projectGroups)
              ? {}
              : { folderWorkspacePathStatuses: {} })
          }
        })
      }

      try {
        const target = { kind: 'local' as const }
        const fence = claimHostCatalogFence(get, 'project-groups', target)
        applyCatalog(await fetchProjectGroupCatalogForTarget(target), fence)
      } catch (err) {
        console.error('Failed to fetch local project groups for all-host load:', err)
      }
      if (options?.remoteHosts === 'skip') {
        return
      }

      const environments = await listRuntimeEnvironmentsForAllHostLoad()
      await Promise.all(
        environments.map(async (environment) => {
          const target = {
            kind: 'environment' as const,
            environmentId: environment.id
          }
          const fence = claimHostCatalogFence(get, 'project-groups', target)
          try {
            applyCatalog(await fetchProjectGroupCatalogForTarget(target), fence)
          } catch (err) {
            console.warn(`Skipped project groups for runtime environment ${environment.id}:`, err)
          }
        })
      )
    }
  }
}
