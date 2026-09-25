import { describe, expect, it } from 'vitest'
import { FileTree } from '@pierre/trees'

import {
  applyTreeFileListMutations,
  mapFsEventsToTreeFileMutations,
  type FileExplorerTreeFileMutation
} from './file-explorer-tree-watch-mutations'
import {
  buildTreeModelBatchOps,
  type TreeMutationModelProbe
} from './file-explorer-tree-batch-operations'

const worktreePath = '/repo'

function probe(paths: Record<string, boolean>): TreeMutationModelProbe {
  return {
    getItem: (path: string) => {
      const key = path.replace(/\/+$/, '')
      if (!(key in paths)) {
        return null
      }
      return { isDirectory: () => paths[key] }
    }
  }
}

describe('mapFsEventsToTreeFileMutations', () => {
  it('ignores payloads for other worktrees', () => {
    const result = mapFsEventsToTreeFileMutations({
      payload: {
        worktreePath: '/other',
        events: [{ kind: 'create', absolutePath: '/other/a.txt' }]
      },
      worktreePath,
      files: []
    })
    expect(result).toEqual({ mutations: [], needsFullRelist: false })
  })

  it('escalates overflow to a full relist', () => {
    const result = mapFsEventsToTreeFileMutations({
      payload: {
        worktreePath,
        events: [
          { kind: 'create', absolutePath: '/repo/a.txt' },
          { kind: 'overflow', absolutePath: '' }
        ]
      },
      worktreePath,
      files: []
    })
    expect(result.needsFullRelist).toBe(true)
    expect(result.mutations).toEqual([])
  })

  it('maps create, delete, and rename events to relative mutations', () => {
    const result = mapFsEventsToTreeFileMutations({
      payload: {
        worktreePath,
        events: [
          { kind: 'create', absolutePath: '/repo/new.txt', isDirectory: false },
          { kind: 'delete', absolutePath: '/repo/gone.txt' },
          {
            kind: 'rename',
            absolutePath: '/repo/UPPER.txt',
            oldAbsolutePath: '/repo/upper.txt',
            isDirectory: false
          }
        ]
      },
      worktreePath,
      files: ['gone.txt', 'upper.txt']
    })
    expect(result.mutations).toEqual([
      { kind: 'create', relativePath: 'new.txt', isDirectory: false },
      { kind: 'delete', relativePath: 'gone.txt', isDirectory: false },
      {
        kind: 'rename',
        fromRelativePath: 'upper.txt',
        toRelativePath: 'UPPER.txt',
        isDirectory: false
      }
    ])
  })

  it('infers directory deletes from cached children', () => {
    const result = mapFsEventsToTreeFileMutations({
      payload: { worktreePath, events: [{ kind: 'delete', absolutePath: '/repo/dir' }] },
      worktreePath,
      files: ['dir/a.txt', 'keep.txt']
    })
    expect(result.mutations).toEqual([{ kind: 'delete', relativePath: 'dir', isDirectory: true }])
  })

  it('treats a rename from outside the worktree as a create with metadata', () => {
    const result = mapFsEventsToTreeFileMutations({
      payload: {
        worktreePath,
        events: [
          {
            kind: 'rename',
            absolutePath: '/repo/in.txt',
            oldAbsolutePath: '/elsewhere/out.txt',
            isDirectory: false
          }
        ]
      },
      worktreePath,
      files: []
    })
    expect(result.mutations).toEqual([
      { kind: 'create', relativePath: 'in.txt', isDirectory: false }
    ])
  })

  it('treats an update of an unknown path as a create when metadata is authoritative', () => {
    const result = mapFsEventsToTreeFileMutations({
      payload: {
        worktreePath,
        events: [
          { kind: 'update', absolutePath: '/repo/known.txt' },
          { kind: 'update', absolutePath: '/repo/unknown.txt', isDirectory: false }
        ]
      },
      worktreePath,
      files: ['known.txt']
    })
    expect(result.mutations).toEqual([
      { kind: 'create', relativePath: 'unknown.txt', isDirectory: false }
    ])
  })

  it('relist unknown creates instead of inventing a file type', () => {
    const result = mapFsEventsToTreeFileMutations({
      payload: {
        worktreePath,
        events: [{ kind: 'create', absolutePath: '/repo/unknown' }]
      },
      worktreePath,
      files: []
    })
    expect(result).toEqual({ mutations: [], needsFullRelist: true })
  })

  it('infers a directory create from descendants seen earlier in the batch', () => {
    const result = mapFsEventsToTreeFileMutations({
      payload: {
        worktreePath,
        events: [
          { kind: 'create', absolutePath: '/repo/dir/a.txt', isDirectory: false },
          { kind: 'create', absolutePath: '/repo/dir' }
        ]
      },
      worktreePath,
      files: []
    })
    expect(result.mutations).toEqual([
      { kind: 'create', relativePath: 'dir/a.txt', isDirectory: false },
      { kind: 'create', relativePath: 'dir', isDirectory: true }
    ])
  })
})

describe('applyTreeFileListMutations', () => {
  it('adds created files and keeps directory entries slashed', () => {
    expect(
      applyTreeFileListMutations(
        ['a.txt'],
        [
          { kind: 'create', relativePath: 'b.txt', isDirectory: false },
          { kind: 'create', relativePath: 'dir', isDirectory: true }
        ]
      )
    ).toEqual(['a.txt', 'b.txt', 'dir/'])
  })

  it('removes deleted subtrees so a later reset cannot resurrect them', () => {
    expect(
      applyTreeFileListMutations(
        ['dir/a.txt', 'dir/nested/b.txt', 'dir2/', 'keep.txt'],
        [
          { kind: 'delete', relativePath: 'dir', isDirectory: true },
          { kind: 'delete', relativePath: 'dir2', isDirectory: true }
        ]
      )
    ).toEqual(['keep.txt'])
  })

  it('renames files and whole directory subtrees', () => {
    expect(
      applyTreeFileListMutations(
        ['dir/a.txt', 'dir/nested/b.txt', 'file.txt'],
        [
          { kind: 'rename', fromRelativePath: 'dir', toRelativePath: 'renamed', isDirectory: true },
          {
            kind: 'rename',
            fromRelativePath: 'file.txt',
            toRelativePath: 'moved.txt',
            isDirectory: false
          }
        ]
      )
    ).toEqual(['renamed/a.txt', 'renamed/nested/b.txt', 'moved.txt'])
  })

  it('is idempotent for duplicate create events', () => {
    const mutations: FileExplorerTreeFileMutation[] = [
      { kind: 'create', relativePath: 'a.txt', isDirectory: false },
      { kind: 'create', relativePath: 'a.txt', isDirectory: false }
    ]
    expect(applyTreeFileListMutations([], mutations)).toEqual(['a.txt'])
  })
  it('replaces incompatible path types and file ancestors in the flat cache', () => {
    expect(
      applyTreeFileListMutations(
        ['node', 'node/stale.txt', 'parent'],
        [
          { kind: 'create', relativePath: 'node', isDirectory: false },
          { kind: 'create', relativePath: 'parent/child.txt', isDirectory: false }
        ]
      )
    ).toEqual(['node', 'parent/child.txt'])
    expect(
      applyTreeFileListMutations(
        ['node'],
        [{ kind: 'create', relativePath: 'node', isDirectory: true }]
      )
    ).toEqual(['node/'])
  })

  it('replaces a rename destination subtree before remapping its source', () => {
    expect(
      applyTreeFileListMutations(
        ['source/a.txt', 'destination', 'destination/stale.txt'],
        [
          {
            kind: 'rename',
            fromRelativePath: 'source',
            toRelativePath: 'destination',
            isDirectory: true
          }
        ]
      )
    ).toEqual(['destination/a.txt'])
  })
})

describe('buildTreeModelBatchOps', () => {
  const passAll = (): boolean => true

  it('skips creates already present and deletes already gone', () => {
    const ops = buildTreeModelBatchOps(
      probe({ 'a.txt': false }),
      [
        { kind: 'create', relativePath: 'a.txt', isDirectory: false },
        { kind: 'delete', relativePath: 'missing.txt', isDirectory: false }
      ],
      passAll
    )
    expect(ops).toEqual([])
  })

  it('adds directory creates with a canonical trailing slash', () => {
    const ops = buildTreeModelBatchOps(
      probe({}),
      [{ kind: 'create', relativePath: 'dir', isDirectory: true }],
      passAll
    )
    expect(ops).toEqual([{ type: 'add', path: 'dir/' }])
  })

  it('filters hidden creates out', () => {
    const ops = buildTreeModelBatchOps(
      probe({}),
      [{ kind: 'create', relativePath: '.hidden', isDirectory: false }],
      (path) => !path.startsWith('.')
    )
    expect(ops).toEqual([])
  })

  it('moves known renames with replace semantics at the destination', () => {
    const ops = buildTreeModelBatchOps(
      probe({ 'a.txt': false, dir: true, 'clash.txt': false, 'other.txt': false }),
      [
        { kind: 'rename', fromRelativePath: 'a.txt', toRelativePath: 'b.txt', isDirectory: false },
        { kind: 'rename', fromRelativePath: 'dir', toRelativePath: 'dir2', isDirectory: true },
        {
          kind: 'rename',
          fromRelativePath: 'other.txt',
          toRelativePath: 'clash.txt',
          isDirectory: false
        }
      ],
      passAll
    )
    expect(ops).toEqual([
      { type: 'move', from: 'a.txt', to: 'b.txt', collision: 'replace' },
      { type: 'move', from: 'dir/', to: 'dir2/', collision: 'replace' },
      { type: 'move', from: 'other.txt', to: 'clash.txt', collision: 'replace' }
    ])
  })

  it('reconciles sequential delete-create replacement against virtual batch state', () => {
    const ops = buildTreeModelBatchOps(
      probe({ item: false }),
      [
        { kind: 'delete', relativePath: 'item', isDirectory: false },
        { kind: 'create', relativePath: 'item', isDirectory: false }
      ],
      passAll
    )
    expect(ops).toEqual([
      { type: 'remove', path: 'item', recursive: true },
      { type: 'add', path: 'item' }
    ])
  })

  it('reconciles implicit directories across a sequential delete and recreate', () => {
    const model = new FileTree({
      paths: [],
      initialExpansion: 'closed',
      flattenEmptyDirectories: false
    })
    try {
      const ops = buildTreeModelBatchOps(
        model,
        [
          { kind: 'create', relativePath: 'dir/child.ts', isDirectory: false },
          { kind: 'delete', relativePath: 'dir', isDirectory: true },
          { kind: 'create', relativePath: 'dir/child.ts', isDirectory: false }
        ],
        passAll
      )
      expect(ops).toEqual([
        { type: 'add', path: 'dir/child.ts' },
        { type: 'remove', path: 'dir/', recursive: true },
        { type: 'add', path: 'dir/child.ts' }
      ])
      model.batch(ops ?? [])
      expect(model.getItem('dir/child.ts')).not.toBeNull()
    } finally {
      model.cleanUp()
    }
  })

  it('does not plan removal for a create filtered out of the model', () => {
    expect(
      buildTreeModelBatchOps(
        probe({}),
        [
          { kind: 'create', relativePath: '.hidden', isDirectory: false },
          { kind: 'delete', relativePath: '.hidden', isDirectory: false }
        ],
        () => false
      )
    ).toEqual([])
  })

  it('replaces path types and creates implicit directories under former files', () => {
    expect(
      buildTreeModelBatchOps(
        probe({ entry: true }),
        [{ kind: 'create', relativePath: 'entry', isDirectory: false }],
        passAll
      )
    ).toEqual([
      { type: 'remove', path: 'entry/', recursive: true },
      { type: 'add', path: 'entry' }
    ])
    expect(
      buildTreeModelBatchOps(
        probe({ parent: false }),
        [{ kind: 'create', relativePath: 'parent/child.txt', isDirectory: false }],
        passAll
      )
    ).toEqual([
      { type: 'remove', path: 'parent', recursive: true },
      { type: 'add', path: 'parent/child.txt' }
    ])
  })

  it('escalates a directory rename with an unknown source to a relist', () => {
    const ops = buildTreeModelBatchOps(
      probe({}),
      [{ kind: 'rename', fromRelativePath: 'dir', toRelativePath: 'dir2', isDirectory: true }],
      passAll
    )
    expect(ops).toBeNull()
  })

  it('adds a file rename whose source the model never had', () => {
    const ops = buildTreeModelBatchOps(
      probe({}),
      [{ kind: 'rename', fromRelativePath: 'a.txt', toRelativePath: 'b.txt', isDirectory: false }],
      passAll
    )
    expect(ops).toEqual([{ type: 'add', path: 'b.txt' }])
  })
})
