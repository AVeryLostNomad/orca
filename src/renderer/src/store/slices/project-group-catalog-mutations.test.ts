import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import {
  createCompatibleRuntimeStatusResponseIfNeeded,
  type RuntimeEnvironmentCallRequest
} from '../../runtime/runtime-compatibility-test-fixture'
import { clearRuntimeCompatibilityCacheForTests } from '../../runtime/runtime-rpc-client'
import { createTestStore } from './store-test-helpers'

const projectGroupsList = vi.fn()
const projectGroupsCreate = vi.fn()
const projectGroupsUpdate = vi.fn()
const projectGroupsDelete = vi.fn()
const runtimeEnvironmentCall = vi.fn()
const runtimeEnvironmentTransportCall = vi.fn()

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function makeGroup(overrides: Partial<ProjectGroup> = {}): ProjectGroup {
  return {
    id: 'group-1',
    name: 'Platform',
    parentPath: null,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function runtimeResponse(result: unknown) {
  return { id: 'rpc-1', ok: true, result, _meta: { runtimeId: 'runtime-remote' } }
}

beforeEach(() => {
  clearRuntimeCompatibilityCacheForTests()
  projectGroupsList.mockReset()
  projectGroupsCreate.mockReset()
  projectGroupsUpdate.mockReset()
  projectGroupsDelete.mockReset()
  runtimeEnvironmentCall.mockReset()
  runtimeEnvironmentTransportCall.mockReset()
  projectGroupsList.mockResolvedValue([])
  runtimeEnvironmentTransportCall.mockImplementation((args: RuntimeEnvironmentCallRequest) => {
    return createCompatibleRuntimeStatusResponseIfNeeded(args) ?? runtimeEnvironmentCall(args)
  })
  vi.stubGlobal('window', {
    api: {
      projectGroups: {
        list: projectGroupsList,
        create: projectGroupsCreate,
        update: projectGroupsUpdate,
        delete: projectGroupsDelete
      },
      runtimeEnvironments: { call: runtimeEnvironmentTransportCall }
    }
  })
})

describe('project group catalog mutation ordering', () => {
  it('does not append a create response already inserted by a newer refresh', async () => {
    const created = makeGroup({ id: 'created', name: 'Created', updatedAt: 2 })
    const create = deferred<ProjectGroup>()
    projectGroupsCreate.mockReturnValue(create.promise)
    projectGroupsList.mockResolvedValue([created])
    const store = createTestStore()

    const pendingCreate = store.getState().createProjectGroup(created.name)
    await store.getState().fetchProjectGroups()
    create.resolve(created)
    await pendingCreate

    expect(store.getState().projectGroups).toEqual([{ ...created, executionHostId: 'local' }])
  })

  it('does not let a refresh started during create remove the committed group', async () => {
    const created = makeGroup({ id: 'created', name: 'Created', updatedAt: 2 })
    const create = deferred<ProjectGroup>()
    const refresh = deferred<ProjectGroup[]>()
    projectGroupsCreate.mockReturnValue(create.promise)
    projectGroupsList.mockReturnValue(refresh.promise)
    const store = createTestStore()

    const pendingCreate = store.getState().createProjectGroup(created.name)
    const pendingRefresh = store.getState().fetchProjectGroups()
    create.resolve(created)
    await pendingCreate
    refresh.resolve([])
    await pendingRefresh

    expect(store.getState().projectGroups).toEqual([{ ...created, executionHostId: 'local' }])
  })

  it('does not let a refresh started during deletion restore the group', async () => {
    const group = makeGroup({ executionHostId: 'local' })
    const deleted = deferred<boolean>()
    const refresh = deferred<ProjectGroup[]>()
    projectGroupsList.mockReturnValue(refresh.promise)
    projectGroupsDelete.mockReturnValue(deleted.promise)
    const store = createTestStore()
    store.setState({ projectGroups: [group] })

    const pendingDelete = store.getState().deleteProjectGroup(group.id, { hostId: 'local' })
    const pendingRefresh = store.getState().fetchProjectGroups()
    deleted.resolve(true)
    await pendingDelete
    refresh.resolve([group])
    await pendingRefresh

    expect(store.getState().projectGroups).toEqual([])
  })

  it('does not let a refresh started during update overwrite the committed group', async () => {
    const group = makeGroup({ executionHostId: 'local' })
    const update = deferred<ProjectGroup>()
    const refresh = deferred<ProjectGroup[]>()
    projectGroupsList.mockReturnValue(refresh.promise)
    projectGroupsUpdate.mockReturnValue(update.promise)
    const store = createTestStore()
    store.setState({ projectGroups: [group] })

    const pendingUpdate = store.getState().updateProjectGroup(group.id, { name: 'Updated' })
    const pendingRefresh = store.getState().fetchProjectGroups()
    update.resolve(makeGroup({ name: 'Updated', updatedAt: 2 }))
    await pendingUpdate
    refresh.resolve([group])
    await pendingRefresh

    expect(store.getState().projectGroups).toEqual([{ ...group, name: 'Updated', updatedAt: 2 }])
  })

  it('merges a mutation response after a refresh snapshot completed before the commit', async () => {
    const group = makeGroup({ executionHostId: 'local' })
    const update = deferred<ProjectGroup>()
    projectGroupsUpdate.mockReturnValue(update.promise)
    projectGroupsList.mockResolvedValue([makeGroup({ name: 'Refreshed', updatedAt: 3 })])
    const store = createTestStore()
    store.setState({ projectGroups: [group] })

    const pendingUpdate = store.getState().updateProjectGroup(group.id, { name: 'Mutation' })
    await store.getState().fetchProjectGroups()
    update.resolve(makeGroup({ name: 'Mutation', updatedAt: 2 }))
    await pendingUpdate

    expect(store.getState().projectGroups).toEqual([{ ...group, name: 'Mutation', updatedAt: 3 }])
  })

  it('ignores an older mutation response after a newer mutation for the same group', async () => {
    const group = makeGroup({ executionHostId: 'local' })
    const older = deferred<ProjectGroup>()
    const newer = deferred<ProjectGroup>()
    projectGroupsUpdate.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const store = createTestStore()
    store.setState({ projectGroups: [group] })

    const pendingOlder = store.getState().updateProjectGroup(group.id, { name: 'Older' })
    const pendingNewer = store.getState().updateProjectGroup(group.id, { name: 'Newer' })
    newer.resolve(makeGroup({ name: 'Newer', updatedAt: 3 }))
    await pendingNewer
    older.resolve(makeGroup({ name: 'Older', updatedAt: 2 }))
    await pendingOlder

    expect(store.getState().projectGroups).toEqual([{ ...group, name: 'Newer', updatedAt: 3 }])
  })

  it('merges independent fields when concurrent updates resolve in reverse order', async () => {
    const group = makeGroup({ executionHostId: 'local' })
    const nameUpdate = deferred<ProjectGroup>()
    const colorUpdate = deferred<ProjectGroup>()
    projectGroupsUpdate
      .mockReturnValueOnce(nameUpdate.promise)
      .mockReturnValueOnce(colorUpdate.promise)
    const store = createTestStore()
    store.setState({ projectGroups: [group] })

    const pendingName = store.getState().updateProjectGroup(group.id, { name: 'Renamed' })
    const pendingColor = store.getState().updateProjectGroup(group.id, { color: '#abcdef' })
    colorUpdate.resolve(makeGroup({ color: '#abcdef', updatedAt: 3 }))
    await pendingColor
    nameUpdate.resolve(makeGroup({ name: 'Renamed', updatedAt: 2 }))
    await pendingName

    expect(store.getState().projectGroups).toEqual([
      { ...group, name: 'Renamed', color: '#abcdef', updatedAt: 3 }
    ])
  })

  it('keeps an independent runtime refresh while a local mutation is in flight', async () => {
    const localGroup = makeGroup({ executionHostId: 'local' })
    const remoteGroup = makeGroup({ id: 'remote-group', name: 'Remote', updatedAt: 2 })
    const update = deferred<ProjectGroup>()
    const remoteRefresh = deferred<unknown>()
    projectGroupsUpdate.mockReturnValue(update.promise)
    runtimeEnvironmentCall.mockImplementation((args: RuntimeEnvironmentCallRequest) => {
      if (args.method === 'projectGroup.list') {
        return remoteRefresh.promise
      }
      throw new Error(`Unexpected runtime RPC: ${args.method}`)
    })
    const store = createTestStore()
    store.setState({ projectGroups: [localGroup] })

    const pendingUpdate = store
      .getState()
      .updateProjectGroup(localGroup.id, { name: 'Local updated' })
    const pendingRefresh = store.getState().fetchProjectGroups({ runtimeEnvironmentId: 'env-1' })
    remoteRefresh.resolve(runtimeResponse({ groups: [remoteGroup] }))
    await pendingRefresh
    update.resolve(makeGroup({ name: 'Local updated', updatedAt: 2 }))
    await pendingUpdate

    expect(store.getState().projectGroups).toEqual([
      { ...localGroup, name: 'Local updated', updatedAt: 2 },
      { ...remoteGroup, executionHostId: 'runtime:env-1' }
    ])
  })
})
