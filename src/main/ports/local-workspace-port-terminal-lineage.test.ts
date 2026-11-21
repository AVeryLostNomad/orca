import { describe, expect, it } from 'vitest'
import type { WorkspacePortProbe } from '../../shared/workspace-ports'
import { enrichPort, normalizeWorkspacePortProbes } from './local-workspace-port-attribution'
import { windowsAncestorPids } from './windows-process-lineage'

const noUrls = { lookup: () => undefined }

const probe = (id: string, path: string): WorkspacePortProbe => ({
  id,
  repoId: 'repo',
  displayName: id,
  path
})

describe('windowsAncestorPids', () => {
  const rows = [
    { pid: 10, ppid: 1, creationTimeMs: 100 }, // terminal shell
    { pid: 20, ppid: 10, creationTimeMs: 200 }, // npm
    { pid: 30, ppid: 20, creationTimeMs: 300 } // node vite (listener)
  ]
  const byPid = new Map(rows.map((row) => [row.pid, row]))

  it('walks the parent chain nearest first', () => {
    expect(windowsAncestorPids(rows[2]!, byPid)).toEqual([20, 10])
  })

  it('stops at a reused pid whose process started after the child', () => {
    const reused = new Map(byPid)
    reused.set(20, { pid: 20, ppid: 10, creationTimeMs: 999 })
    expect(windowsAncestorPids(rows[2]!, reused)).toEqual([])
  })

  it('survives a ppid cycle', () => {
    const cyclic = new Map([
      [1, { pid: 1, ppid: 2 }],
      [2, { pid: 2, ppid: 1 }]
    ])
    expect(windowsAncestorPids({ pid: 3, ppid: 1 }, cyclic)).toEqual([1, 2])
  })
})

describe('terminal lineage attribution', () => {
  const worktrees = normalizeWorkspacePortProbes([
    probe('wt-a', 'C:/work/a'),
    probe('wt-b', 'C:/work/b')
  ])

  it('attributes a listener with no path evidence to the workspace whose terminal spawned it', () => {
    const port = enrichPort(
      { host: '127.0.0.1', port: 5100, pid: 30, commandLine: 'dotnet run', ancestorPids: [20, 10] },
      worktrees,
      noUrls,
      new Map([[10, 'wt-b']])
    )
    expect(port).toMatchObject({
      kind: 'workspace',
      owner: { worktreeId: 'wt-b', confidence: 'terminal' }
    })
  })

  it('prefers cwd evidence over terminal lineage', () => {
    const port = enrichPort(
      { host: '127.0.0.1', port: 5100, pid: 30, cwd: 'C:/work/a/app', ancestorPids: [10] },
      worktrees,
      noUrls,
      new Map([[10, 'wt-b']])
    )
    expect(port).toMatchObject({
      kind: 'workspace',
      owner: { worktreeId: 'wt-a', confidence: 'cwd' }
    })
  })

  it('ignores terminals of workspaces outside the scan', () => {
    const port = enrichPort(
      { host: '127.0.0.1', port: 5100, pid: 30, ancestorPids: [10] },
      worktrees,
      noUrls,
      new Map([[10, 'wt-gone']])
    )
    expect(port.kind).toBe('external')
  })
})
