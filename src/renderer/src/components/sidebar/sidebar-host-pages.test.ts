import { describe, expect, it } from 'vitest'
import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { SidebarHostOption } from './sidebar-host-options'
import {
  buildSidebarHostPages,
  collectSidebarContentHostIds,
  resolveActiveSidebarHostPage
} from './sidebar-host-pages'
import { resolveSidebarRevealPageId } from './sidebar-reveal-host'

function host(id: ExecutionHostId, label: string = id): SidebarHostOption {
  return {
    id,
    label,
    detail: '',
    kind: id === 'local' ? 'local' : id.startsWith('ssh:') ? 'ssh' : 'runtime',
    health: id === 'local' ? 'local' : 'available',
    presence: id === 'local' ? 'local' : 'project'
  }
}

function repo(id: string, overrides: Partial<Repo> = {}): Repo {
  return { id, path: `/repo/${id}`, displayName: id, ...overrides } as Repo
}

function worktree(id: string, repoId: string, overrides: Partial<Worktree> = {}): Worktree {
  return { id, repoId, path: `/wt/${id}`, isArchived: false, ...overrides } as Worktree
}

const HOSTS = [host('local', 'Local Mac'), host('runtime:desk', 'Rionya desktop'), host('ssh:box')]

describe('buildSidebarHostPages', () => {
  it('keeps local first and pages only remote hosts that own sidebar content', () => {
    const pages = buildSidebarHostPages({
      hostOptions: HOSTS,
      workspaceHostOrder: [],
      contentHostIds: new Set(['runtime:desk']),
      visibleHostIdSet: null
    })

    expect(pages.map((page) => page.id)).toEqual(['local', 'runtime:desk'])
  })

  it('orders remote pages by the saved host order', () => {
    const pages = buildSidebarHostPages({
      hostOptions: HOSTS,
      workspaceHostOrder: ['ssh:box', 'local', 'runtime:desk'],
      contentHostIds: new Set(['runtime:desk', 'ssh:box', 'local']),
      visibleHostIdSet: null
    })

    expect(pages.map((page) => page.id)).toEqual(['local', 'ssh:box', 'runtime:desk'])
  })

  it('drops pages the Hosts filter hides, and still pages content from unregistered hosts', () => {
    const pages = buildSidebarHostPages({
      hostOptions: HOSTS,
      workspaceHostOrder: [],
      contentHostIds: new Set(['runtime:desk', 'ssh:ghost']),
      visibleHostIdSet: new Set(['ssh:ghost', 'runtime:desk'])
    })

    expect(pages.map((page) => [page.id, page.kind])).toEqual([
      ['runtime:desk', 'runtime'],
      ['ssh:ghost', 'ssh']
    ])
  })

  it('shows the first filtered-in host when none of them owns content', () => {
    const pages = buildSidebarHostPages({
      hostOptions: HOSTS,
      workspaceHostOrder: [],
      contentHostIds: new Set(),
      visibleHostIdSet: new Set(['ssh:box'])
    })

    expect(pages.map((page) => page.id)).toEqual(['ssh:box'])
  })
})

describe('collectSidebarContentHostIds', () => {
  it('assigns hosts the way the row pipeline does', () => {
    const group = { id: 'group-1', executionHostId: 'ssh:box' } as ProjectGroup
    const hostIds = collectSidebarContentHostIds({
      repos: [
        repo('local-repo', { executionHostId: 'local' }),
        repo('desk-repo', { executionHostId: 'runtime:desk' }),
        repo('legacy-ssh-repo', { connectionId: 'old-box' }),
        repo('unhosted-repo')
      ],
      projectGroups: [group],
      folderWorkspaces: [{ id: 'fw-1', projectGroupId: group.id } as FolderWorkspace],
      worktreesByRepo: {
        'local-repo': [worktree('moved', 'local-repo', { hostId: 'ssh:worktree-box' })],
        'desk-repo': [worktree('archived', 'desk-repo', { hostId: 'ssh:gone', isArchived: true })],
        'missing-repo': [worktree('orphan', 'missing-repo', { hostId: 'ssh:orphan' })]
      },
      defaultHostId: 'runtime:focused'
    })

    expect([...hostIds].sort()).toEqual([
      'local',
      'runtime:desk',
      'runtime:focused',
      'ssh:box',
      'ssh:old-box',
      'ssh:worktree-box'
    ])
  })
})

describe('host page selection', () => {
  const pages = buildSidebarHostPages({
    hostOptions: HOSTS,
    workspaceHostOrder: [],
    contentHostIds: new Set(['runtime:desk', 'ssh:box']),
    visibleHostIdSet: null
  })

  it('falls back to the first page when the saved page no longer exists', () => {
    expect(resolveActiveSidebarHostPage(pages, 'runtime:desk').id).toBe('runtime:desk')
    expect(resolveActiveSidebarHostPage(pages, 'runtime:removed').id).toBe('local')
  })

  it('moves a reveal to the page that renders its target', () => {
    expect(resolveSidebarRevealPageId(pages, 'local', ['ssh:box'])).toBe('ssh:box')
    // A project checked out on several hosts stays on the page already showing it.
    expect(resolveSidebarRevealPageId(pages, 'runtime:desk', ['local', 'runtime:desk'])).toBe(
      'runtime:desk'
    )
    // No page for the target: the active page consumes and clears the stale reveal.
    expect(resolveSidebarRevealPageId(pages, 'local', ['ssh:hidden'])).toBe('local')
    expect(resolveSidebarRevealPageId(pages, 'local', [])).toBe('local')
  })
})
