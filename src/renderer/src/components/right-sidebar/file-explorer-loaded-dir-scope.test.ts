import { describe, expect, it } from 'vitest'
import {
  scopeFsEventsToLoadedDirs,
  scopeMutationsToLoadedDirs
} from './file-explorer-loaded-dir-scope'
import { mapFsEventsToTreeFileMutations } from './file-explorer-tree-watch-mutations'

const ROOT = '/repo'
const loaded = new Set(['', 'src'])
const isDirLoaded = (relativeDir: string): boolean => loaded.has(relativeDir)

describe('scopeMutationsToLoadedDirs', () => {
  it('collapses churn inside an unloaded folder onto that folder row', () => {
    const scoped = scopeMutationsToLoadedDirs(
      [
        { kind: 'create', relativePath: 'work/models/a.bin', isDirectory: false },
        { kind: 'create', relativePath: 'work/models/b.bin', isDirectory: false },
        { kind: 'delete', relativePath: 'work/old.bin', isDirectory: false },
        { kind: 'create', relativePath: 'src/new.ts', isDirectory: false }
      ],
      isDirLoaded
    )
    expect(scoped).toEqual([
      { kind: 'create', relativePath: 'work', isDirectory: true },
      { kind: 'create', relativePath: 'src/new.ts', isDirectory: false }
    ])
  })

  it('turns a move into an unloaded folder into a delete of the visible source', () => {
    const scoped = scopeMutationsToLoadedDirs(
      [
        {
          kind: 'rename',
          fromRelativePath: 'src/a.ts',
          toRelativePath: 'lib/a.ts',
          isDirectory: false
        }
      ],
      isDirLoaded
    )
    expect(scoped).toEqual([
      { kind: 'delete', relativePath: 'src/a.ts', isDirectory: false },
      { kind: 'create', relativePath: 'lib', isDirectory: true }
    ])
  })
})

describe('scopeFsEventsToLoadedDirs', () => {
  it('keeps kind-less events in unloaded folders from forcing a relist', () => {
    const payload = {
      worktreePath: ROOT,
      events: [
        { kind: 'create' as const, absolutePath: `${ROOT}/work/ckpt/step-1` },
        { kind: 'update' as const, absolutePath: `${ROOT}/work/ckpt/step-2` }
      ]
    }
    expect(
      mapFsEventsToTreeFileMutations({ payload, worktreePath: ROOT, files: ['work/'] })
    ).toMatchObject({ needsFullRelist: true })

    const scoped = scopeFsEventsToLoadedDirs(payload, ROOT, isDirLoaded)
    expect(
      mapFsEventsToTreeFileMutations({ payload: scoped, worktreePath: ROOT, files: ['work/'] })
    ).toEqual({
      mutations: [{ kind: 'create', relativePath: 'work', isDirectory: true }],
      needsFullRelist: false
    })
  })
})
