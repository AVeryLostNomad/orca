import {
  mkdtempSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getPathMock, authorizeExternalPathMock } = vi.hoisted(() => ({
  getPathMock: vi.fn(),
  authorizeExternalPathMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: getPathMock },
  ipcMain: { handle: vi.fn() }
}))

vi.mock('./ipc/filesystem-auth', () => ({
  authorizeExternalPath: authorizeExternalPathMock
}))

import { ensureWorkspaceNotesFile } from './ipc/workspace-notes'
import {
  deleteWorkspaceNotesDir,
  schedulePendingWorkspaceNotesRemovals
} from './workspace-notes-deletion'
import { getWorkspaceNotesDir, getWorkspaceNotesRoot } from './workspace-notes-paths'
import { flushPendingWorktreeHistoryDeletions } from './terminal-history-deletion'
import { PENDING_DELETE_DIR_NAME } from './terminal-history-paths'

describe('workspace notes storage', () => {
  let userDataDir: string

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'orca-workspace-notes-'))
    getPathMock.mockReturnValue(userDataDir)
    authorizeExternalPathMock.mockClear()
  })

  afterEach(async () => {
    await rm(userDataDir, { recursive: true, force: true })
  })

  it('creates the notes file with the templated header and ownership meta', async () => {
    const result = await ensureWorkspaceNotesFile({
      workspaceId: 'repo-1::/tmp/wt-a',
      displayName: 'My Feature'
    })

    expect(readFileSync(result.filePath, 'utf-8')).toBe('# Notes for My Feature\n-')
    const dir = getWorkspaceNotesDir('repo-1::/tmp/wt-a')
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8'))
    expect(meta.worktreeId).toBe('repo-1::/tmp/wt-a')
    expect(typeof meta.createdAt).toBe('string')
    expect(authorizeExternalPathMock).toHaveBeenCalledWith(getWorkspaceNotesRoot())
  })

  it('never overwrites existing notes content on re-ensure', async () => {
    const first = await ensureWorkspaceNotesFile({ workspaceId: 'wt-b', displayName: 'Old Name' })
    writeFileSync(first.filePath, '# Notes for Old Name\n- user content')

    const second = await ensureWorkspaceNotesFile({ workspaceId: 'wt-b', displayName: 'New Name' })

    expect(second.filePath).toBe(first.filePath)
    expect(readFileSync(first.filePath, 'utf-8')).toBe('# Notes for Old Name\n- user content')
  })

  it('rejects an empty workspaceId', async () => {
    await expect(ensureWorkspaceNotesFile({ workspaceId: '', displayName: 'X' })).rejects.toThrow(
      'workspaceId is required'
    )
  })

  it('tombstones and removes the notes dir on workspace removal', async () => {
    const result = await ensureWorkspaceNotesFile({ workspaceId: 'wt-c', displayName: 'C' })
    expect(existsSync(result.filePath)).toBe(true)

    deleteWorkspaceNotesDir('wt-c')
    expect(existsSync(getWorkspaceNotesDir('wt-c'))).toBe(false)
    await flushPendingWorktreeHistoryDeletions()

    const leftovers = existsSync(getWorkspaceNotesRoot())
      ? readdirSync(getWorkspaceNotesRoot()).filter((entry) => entry !== PENDING_DELETE_DIR_NAME)
      : []
    expect(leftovers).toEqual([])
  })

  it('startup drain only touches tombstones — live notes dirs are never reaped', async () => {
    // Why no orphan GC (unlike terminal history): notes must survive an app
    // reinstall that wipes orca-data.json, so "unknown workspace" is not a
    // deletion signal.
    const live = await ensureWorkspaceNotesFile({ workspaceId: 'wt-live', displayName: 'Live' })
    const tombstoned = join(getWorkspaceNotesRoot(), PENDING_DELETE_DIR_NAME, 'stale.123.abc')
    mkdirSync(tombstoned, { recursive: true })
    writeFileSync(join(tombstoned, 'notes.md'), 'stale')

    schedulePendingWorkspaceNotesRemovals()
    await flushPendingWorktreeHistoryDeletions()

    expect(existsSync(live.filePath)).toBe(true)
    expect(existsSync(tombstoned)).toBe(false)
  })
})
