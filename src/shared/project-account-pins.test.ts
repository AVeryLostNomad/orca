import { describe, expect, it } from 'vitest'
import {
  applyInheritedProjectAccountPins,
  resolveGroupAccountPin,
  resolveProjectAccountPin
} from './project-account-pins'
import { createProjectGroup, normalizeProjectGroups } from './project-groups'
import type { ProjectGroup } from './project-group-types'
import type { Repo } from './repo-types'

function repo(overrides: Partial<Repo>): Repo {
  return {
    id: 'repo-1',
    path: '/repo',
    displayName: 'repo',
    badgeColor: '#999',
    addedAt: 1,
    kind: 'git',
    ...overrides
  }
}

function group(overrides: Partial<ProjectGroup>): ProjectGroup {
  return {
    ...createProjectGroup({
      name: overrides.name ?? 'Group',
      createdFrom: 'manual',
      tabOrder: 0
    }),
    ...overrides
  }
}

describe('project account pins', () => {
  const work = group({
    id: 'work',
    name: 'Work',
    claudeAccountId: 'claude-work'
  })
  const nested = group({ id: 'nested', name: 'Nested', parentGroupId: 'work' })
  const groups = [work, nested]

  it('prefers the project pin over its group', () => {
    const pinned = repo({
      projectGroupId: 'work',
      claudeAccountId: 'claude-personal'
    })
    expect(resolveProjectAccountPin(pinned, groups, 'claudeAccountId')).toEqual({
      value: 'claude-personal',
      source: { kind: 'project' }
    })
  })

  it('inherits through nested groups', () => {
    const member = repo({ projectGroupId: 'nested' })
    expect(resolveProjectAccountPin(member, groups, 'claudeAccountId')).toEqual({
      value: 'claude-work',
      source: { kind: 'group', groupId: 'work', groupName: 'Work' }
    })
  })

  it('falls back to none when nothing in the chain pins the field', () => {
    expect(
      resolveProjectAccountPin(repo({ projectGroupId: 'nested' }), groups, 'codexAccountId')
    ).toEqual({ value: null, source: { kind: 'none' } })
  })

  it('does not inherit from a same-id group on another host', () => {
    const sshGroup = group({
      id: 'shared-id',
      connectionId: 'box',
      codexAccountId: 'codex-x'
    })
    expect(
      resolveGroupAccountPin([sshGroup], 'shared-id', 'local', 'codexAccountId').value
    ).toBeNull()
  })

  it('survives a parent cycle', () => {
    const a = group({ id: 'a', parentGroupId: 'b' })
    const b = group({ id: 'b', parentGroupId: 'a' })
    expect(resolveGroupAccountPin([a, b], 'a', 'local', 'githubAccountRef').value).toBeNull()
  })

  it('materializes inherited pins without touching overrides', () => {
    const [inherited, overridden] = applyInheritedProjectAccountPins(
      [
        repo({ id: 'r1', projectGroupId: 'nested' }),
        repo({ id: 'r2', projectGroupId: 'work', claudeAccountId: 'mine' })
      ],
      groups
    )
    expect(inherited.claudeAccountId).toBe('claude-work')
    expect(overridden.claudeAccountId).toBe('mine')
  })

  it('keeps group pins through normalization', () => {
    const [normalized] = normalizeProjectGroups([
      { ...work, githubAccountRef: 'gh:github.com:me', codexAccountId: '  ' }
    ])
    expect(normalized.claudeAccountId).toBe('claude-work')
    expect(normalized.githubAccountRef).toBe('gh:github.com:me')
    expect(normalized).not.toHaveProperty('codexAccountId')
  })
})
