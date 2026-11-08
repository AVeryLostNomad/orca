import { describe, expect, it } from 'vitest'
import type { DirEntry } from '../../../../shared/filesystem-entry-types'
import {
  applyDirReadsToLoadedListing,
  applyMutationsToLoadedListing,
  assembleLoadedListing,
  mergeDirListing,
  selectDirsToAutoLoad,
  withScopeRootExpanded
} from './file-explorer-loaded-listing'

const file = (name: string): DirEntry => ({ name, isDirectory: false, isSymlink: false })
const dir = (name: string): DirEntry => ({ name, isDirectory: true, isSymlink: false })

describe('mergeDirListing', () => {
  it('replaces direct children while keeping loaded descendants of surviving folders', () => {
    const files = ['src/', 'src/a.ts', 'src/old/', 'src/old/x.ts', 'src/keep/', 'src/keep/y.ts']
    const merge = mergeDirListing(files, 'src', ['src/a.ts', 'src/keep/', 'src/new.ts'])

    expect(merge.files.sort()).toEqual([
      'src/',
      'src/a.ts',
      'src/keep/',
      'src/keep/y.ts',
      'src/new.ts'
    ])
    expect(merge.removedDirs).toEqual(['src/old'])
    expect(merge.mutations).toEqual([
      { kind: 'delete', relativePath: 'src/old', isDirectory: true },
      { kind: 'create', relativePath: 'src/new.ts', isDirectory: false }
    ])
  })

  it('treats a file that became a folder as delete + create', () => {
    const merge = mergeDirListing(['out'], '', ['out/'])
    expect(merge.files).toEqual(['out/'])
    expect(merge.mutations).toEqual([
      { kind: 'delete', relativePath: 'out', isDirectory: false },
      { kind: 'create', relativePath: 'out', isDirectory: true }
    ])
  })
})

describe('applyDirReadsToLoadedListing', () => {
  it('attaches children after parents and reports reads whose row is gone', () => {
    const listing = { files: ['a/'], loadedDirs: new Set(['']) }
    const applied = applyDirReadsToLoadedListing(
      listing,
      new Map([
        ['a/b', [file('deep.ts')]],
        ['a', [dir('b')]],
        ['gone', [file('x.ts')]]
      ])
    )
    expect(applied.listing.files).toEqual(['a/', 'a/b/', 'a/b/deep.ts'])
    expect([...applied.listing.loadedDirs].sort()).toEqual(['', 'a', 'a/b'])
    expect(applied.unattachedDirs).toEqual(['gone'])
  })
})

describe('assembleLoadedListing', () => {
  it('only attaches folders reachable through loaded parents', () => {
    const { files, loadedDirs } = assembleLoadedListing(
      new Map([
        ['', [dir('a'), file('README.md'), dir('node_modules')]],
        ['a', [file('x.ts')]],
        ['orphan/child', [file('y.ts')]]
      ])
    )
    expect(files).toEqual(['a/', 'README.md', 'a/x.ts'])
    expect([...loadedDirs]).toEqual(['', 'a'])
  })
})

describe('applyMutationsToLoadedListing', () => {
  it('moves a loaded folder with its loaded descendants', () => {
    const listing = {
      files: ['a/', 'a/b/', 'a/b/c.ts', 'z/'],
      loadedDirs: new Set(['', 'a', 'a/b', 'z'])
    }
    const next = applyMutationsToLoadedListing(listing, [
      { kind: 'rename', fromRelativePath: 'a', toRelativePath: 'z/a', isDirectory: true }
    ])
    expect(next.files.sort()).toEqual(['z/', 'z/a/', 'z/a/b/', 'z/a/b/c.ts'])
    expect([...next.loadedDirs].sort()).toEqual(['', 'z', 'z/a', 'z/a/b'])
  })
})

describe('selectDirsToAutoLoad', () => {
  it('loads an expanded chain together but waits on a parent that is still in flight', () => {
    const expanded = new Set(['a', 'a/b', 'c', 'c/d', 'hidden/under-collapsed'])
    const wanted = selectDirsToAutoLoad(expanded, new Set(['']), (dir) => dir === 'c')
    expect(wanted).toEqual(['a', 'a/b'])
  })

  it('loads folders expanded inside a scoped tree whose root the user never expanded', () => {
    const expanded = withScopeRootExpanded(new Set(['Assets/Scripts']), 'Assets')
    expect(selectDirsToAutoLoad(expanded, new Set(['']), () => false)).toEqual([
      'Assets',
      'Assets/Scripts'
    ])
    expect(selectDirsToAutoLoad(expanded, new Set(['', 'Assets']), () => false)).toEqual([
      'Assets/Scripts'
    ])
  })
})
