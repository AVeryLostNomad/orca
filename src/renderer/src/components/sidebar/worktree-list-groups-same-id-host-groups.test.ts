/** A project moved to a server can leave same-ID group copies on both hosts; render one group header. */
import { describe, expect, it } from 'vitest'
import { getRepoHostIdentityForParts } from '../../../../shared/repo-host-identity'
import { getProjectGroupHeaderKey } from '../../../../shared/sidebar-list/group-keys'
import { buildRows } from './worktree-list/grouping/build-rows.test-fixture'
import { repo, worktree } from './worktree-list-groups-test-fixtures'
import { getRenderRowKey } from './worktree-list/listing/render-row'
import { getSidebarRowRevealAncestorKeys } from './worktree-list/navigation/reveal-ancestors'
import { getProjectGroupOccurrencePaths } from '../../../../shared/sidebar-list/project-group-sections'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import type { ExecutionHostId } from '../../../../shared/execution-host'

const REMOTE_HOST: ExecutionHostId = 'runtime:env-b'

function group(executionHostId: ExecutionHostId, overrides: Partial<ProjectGroup> = {}) {
  return {
    id: 'group-shared',
    name: 'Platform',
    parentPath: null,
    executionHostId,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  } satisfies ProjectGroup
}

const groupedRepo: Repo = { ...repo, projectGroupId: 'group-shared' }
const localWorktree: Worktree = {
  ...worktree,
  id: 'wt-local',
  hostId: 'local'
}
const remoteWorktree: Worktree = {
  ...worktree,
  id: 'wt-remote',
  hostId: REMOTE_HOST
}

function rowsFor(projectGroups: readonly ProjectGroup[], collapsed = new Set<string>()) {
  const worktrees = [localWorktree, remoteWorktree]
  return buildRows(
    'repo',
    worktrees,
    new Map([[groupedRepo.id, groupedRepo]]),
    null,
    collapsed,
    undefined,
    undefined,
    undefined,
    {},
    new Map(worktrees.map((entry) => [entry.id, entry])),
    false,
    undefined,
    projectGroups
  )
}

describe('a project group both hosts publish under one id', () => {
  it('draws one header holding the project, not a second empty one', () => {
    const rows = rowsFor([group('local'), group(REMOTE_HOST, { name: 'Renamed on server' })])

    const groupHeaders = rows.filter((row) => row.type === 'header' && row.projectGroup)
    expect(groupHeaders).toHaveLength(1)
    // Fork: groups are host-qualified, so the project's own host copy is the one drawn.
    expect(groupHeaders[0]).toMatchObject({
      key: 'project-group:group-shared',
      label: 'Platform',
      count: 1
    })
    expect(rows.filter((row) => row.type === 'item')).toHaveLength(2)
  })

  it('gives every rendered row a distinct key', () => {
    const keys = rowsFor([group('local'), group(REMOTE_HOST)]).map(getRenderRowKey)

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('keeps a same-id child group nested once under its parent', () => {
    const parent = (hostId: ExecutionHostId) => group(hostId, { id: 'parent', name: 'Parent' })
    const child = (hostId: ExecutionHostId) => group(hostId, { parentGroupId: 'parent' })

    const rows = rowsFor([parent('local'), child('local'), parent(REMOTE_HOST), child(REMOTE_HOST)])

    expect(
      rows.flatMap((row) =>
        row.type === 'header' && row.projectGroup ? [[row.key, row.projectGroupDepth]] : []
      )
    ).toEqual([
      ['project-group:parent', 0],
      ['project-group:group-shared', 1]
    ])
  })

  it('keeps each copy under its own host parent and draws the populated one', () => {
    const remoteParent = group(REMOTE_HOST, { id: 'parent', name: 'Parent' })
    const groups = [
      group('local'),
      remoteParent,
      group(REMOTE_HOST, { parentGroupId: 'parent' })
    ]

    const rows = rowsFor(groups, new Set(['project-group:parent']))
    expect(rows.filter((row) => row.type === 'header').map((row) => row.key)).toEqual([
      getProjectGroupHeaderKey(remoteParent),
      'project-group:group-shared',
      `repo:${groupedRepo.id}`
    ])
    expect(
      getSidebarRowRevealAncestorKeys({
        rowKey: 'project-group:group-shared',
        repoMap: new Map(),
        projectGroups: groups
      })
    ).toEqual([])
    expect(
      getProjectGroupOccurrencePaths(groups).get(getRepoHostIdentityForParts('group-shared', 'local'))
        ?.parent
    ).toBeUndefined()
  })
})
