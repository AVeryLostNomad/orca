import { describe, expect, it } from 'vitest'
import { FileTree, type FileTreeDirectoryHandle, type FileTreeVisibleRow } from '@pierre/trees'
import type { FileTreeModelLike } from './use-file-explorer-tree-model'
import {
  diffExpandedDirPaths,
  readFileTreeExpansionSnapshot,
  resetFileTreePathsWithExpansion
} from './use-file-tree-expansion-sync'

function makeRow(
  path: string,
  kind: 'directory' | 'file',
  isExpanded: boolean
): FileTreeVisibleRow {
  return {
    ancestorPaths: [],
    depth: 0,
    hasChildren: kind === 'directory',
    index: 0,
    isFocused: false,
    isSelected: false,
    isExpanded,
    isFlattened: false,
    kind,
    level: 0,
    name: path.split('/').at(-1) ?? path,
    path,
    posInSet: 0,
    setSize: 1
  }
}

function makeModel(rows: FileTreeVisibleRow[]): FileTreeModelLike {
  return {
    getVisibleCount: () => rows.length,
    getVisibleRows: (start: number, end: number) => rows.slice(start, end)
  } as unknown as FileTreeModelLike
}

describe('readFileTreeExpansionSnapshot', () => {
  it('splits visible directories by expansion state and ignores files', () => {
    const snapshot = readFileTreeExpansionSnapshot(
      makeModel([
        makeRow('src/', 'directory', true),
        makeRow('src/lib/', 'directory', false),
        makeRow('src/index.ts', 'file', false),
        makeRow('docs', 'directory', true)
      ])
    )
    expect([...snapshot.visibleExpanded].sort()).toEqual(['docs', 'src'])
    expect([...snapshot.visibleCollapsed]).toEqual(['src/lib'])
  })
})

describe('diffExpandedDirPaths', () => {
  it('adds newly expanded visible dirs to the stored set', () => {
    const next = diffExpandedDirPaths(
      { visibleExpanded: new Set(['src', 'src/lib']), visibleCollapsed: new Set() },
      new Set(['src'])
    )
    expect([...next].sort()).toEqual(['src', 'src/lib'])
  })

  it('drops stored dirs that are visibly collapsed', () => {
    const next = diffExpandedDirPaths(
      { visibleExpanded: new Set(['src']), visibleCollapsed: new Set(['src/lib']) },
      new Set(['src', 'src/lib'])
    )
    expect([...next]).toEqual(['src'])
  })

  it('keeps stored dirs hidden under a collapsed ancestor', () => {
    // src is collapsed, so src/lib is not visible at all; nested expansion
    // must survive collapsing and re-expanding the parent.
    const next = diffExpandedDirPaths(
      { visibleExpanded: new Set<string>(), visibleCollapsed: new Set(['src']) },
      new Set(['src', 'src/lib'])
    )
    expect([...next]).toEqual(['src/lib'])
  })

  it('returns only visible expansion when nothing is stored', () => {
    const next = diffExpandedDirPaths(
      { visibleExpanded: new Set(['a']), visibleCollapsed: new Set(['b']) },
      new Set()
    )
    expect([...next]).toEqual(['a'])
  })
})

describe('resetFileTreePathsWithExpansion', () => {
  it('keeps collapsed ancestors closed across rebuilds while remembering nested expansion', () => {
    const paths = ['benchmarks/dandadan/vfx/image.png', 'docs/guide.md']
    const model = new FileTree({
      paths,
      initialExpansion: 'closed',
      initialExpandedPaths: [
        'benchmarks',
        'benchmarks/dandadan',
        'benchmarks/dandadan/vfx',
        'docs'
      ],
      flattenEmptyDirectories: false
    })
    const directory = (path: string): FileTreeDirectoryHandle =>
      model.getItem(path) as FileTreeDirectoryHandle
    try {
      const remembered = readFileTreeExpansionSnapshot(model).visibleExpanded
      directory('benchmarks/dandadan').collapse()
      const afterChildCollapse = diffExpandedDirPaths(
        readFileTreeExpansionSnapshot(model),
        remembered
      )
      directory('benchmarks').collapse()
      const collapsed = diffExpandedDirPaths(
        readFileTreeExpansionSnapshot(model),
        afterChildCollapse
      )

      for (let rebuild = 0; rebuild < 2; rebuild++) {
        resetFileTreePathsWithExpansion(model, paths, collapsed)
        expect(readFileTreeExpansionSnapshot(model).visibleExpanded).toEqual(new Set(['docs']))
      }
      directory('benchmarks').expand()
      expect(readFileTreeExpansionSnapshot(model).visibleCollapsed).toContain('benchmarks/dandadan')
      directory('benchmarks/dandadan').expand()
      expect(model.getVisibleRows(0, model.getVisibleCount()).map((row) => row.path)).toContain(
        'benchmarks/dandadan/vfx/image.png'
      )
    } finally {
      model.cleanUp()
    }
  })
})
