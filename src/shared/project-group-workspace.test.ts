import { describe, expect, it } from 'vitest'
import type { ProjectGroup } from './project-group-types'
import type { Repo } from './repo-types'
import {
  deriveProjectGroupWorkspacePath,
  projectGroupToFolderWorkspace,
  projectGroupWorkspaceKey
} from './project-group-workspace'

const group = (overrides: Partial<ProjectGroup> = {}): ProjectGroup => ({
  id: 'group-1',
  name: 'Platform',
  parentPath: null,
  parentGroupId: null,
  createdFrom: 'manual',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 1,
  updatedAt: 2,
  ...overrides
})

const repo = (overrides: Partial<Repo>): Repo => ({
  id: 'repo-1',
  path: '/workspace/platform/api',
  displayName: 'api',
  badgeColor: 'var(--muted-foreground)',
  addedAt: 1,
  projectGroupId: 'group-1',
  ...overrides
})

describe('deriveProjectGroupWorkspacePath', () => {
  it('uses the shared parent for sibling projects', () => {
    expect(
      deriveProjectGroupWorkspacePath({
        group: group(),
        projectGroups: [group()],
        repos: [repo({}), repo({ id: 'repo-2', path: '/workspace/platform/web' })]
      })
    ).toBe('/workspace/platform')
  })

  it('uses the parent directory for a single project', () => {
    const projectGroup = group()
    expect(
      deriveProjectGroupWorkspacePath({
        group: projectGroup,
        projectGroups: [projectGroup],
        repos: [repo({})]
      })
    ).toBe('/workspace/platform')
  })

  it('includes projects in nested groups and preserves Windows roots', () => {
    const parent = group({ executionHostId: 'local' })
    const child = group({ id: 'group-2', parentGroupId: parent.id, executionHostId: 'local' })
    expect(
      deriveProjectGroupWorkspacePath({
        group: parent,
        projectGroups: [parent, child],
        repos: [
          repo({ path: 'C:\\work\\platform\\api', executionHostId: 'local' }),
          repo({
            id: 'repo-2',
            path: 'C:\\work\\platform\\web',
            projectGroupId: child.id,
            executionHostId: 'local'
          })
        ]
      })
    ).toBe('C:/work/platform')
  })

  it('prefers an imported group parent path', () => {
    const projectGroup = group({ parentPath: '/srv/platform', createdFrom: 'folder-scan' })
    expect(
      deriveProjectGroupWorkspacePath({
        group: projectGroup,
        projectGroups: [projectGroup],
        repos: [repo({ path: '/elsewhere/api' })]
      })
    ).toBe('/srv/platform')
  })
})

describe('projectGroupToFolderWorkspace', () => {
  it('creates a stable Group Wide folder workspace', () => {
    const projectGroup = group()
    expect(
      projectGroupToFolderWorkspace({
        group: projectGroup,
        projectGroups: [projectGroup],
        repos: [repo({})]
      })
    ).toMatchObject({
      id: 'project-group:group-1',
      projectGroupId: 'group-1',
      name: 'Group Wide',
      folderPath: '/workspace/platform'
    })
    expect(projectGroupWorkspaceKey(projectGroup.id)).toBe('folder:project-group:group-1')
  })
})
