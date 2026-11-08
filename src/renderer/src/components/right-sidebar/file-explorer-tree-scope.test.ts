import { describe, expect, it } from 'vitest'
import { scopeTreeInputPaths, scopeTreeMutations } from './file-explorer-tree-scope'

describe('scoped explorer tree', () => {
  it('keeps only paths below the scope root, re-based onto it', () => {
    expect(
      scopeTreeInputPaths('Game/Assets', [
        'Game/',
        'Game/Assets/',
        'Game/Assets/Scripts/',
        'Game/Assets/Scripts/Player.cs',
        'Game/AssetsBackup/x.cs',
        'Game/Packages/manifest.json'
      ])
    ).toEqual(['Scripts/', 'Scripts/Player.cs'])
  })

  it('turns moves across the scope boundary into deletes and creates', () => {
    expect(
      scopeTreeMutations('Assets', [
        {
          kind: 'rename',
          fromRelativePath: 'Assets/A.cs',
          toRelativePath: 'Assets/B.cs',
          isDirectory: false
        },
        {
          kind: 'rename',
          fromRelativePath: 'Assets/C.cs',
          toRelativePath: 'Other/C.cs',
          isDirectory: false
        },
        {
          kind: 'rename',
          fromRelativePath: 'Other/D',
          toRelativePath: 'Assets/D',
          isDirectory: true
        },
        { kind: 'create', relativePath: 'ProjectSettings/x.asset', isDirectory: false }
      ])
    ).toEqual([
      { kind: 'rename', fromRelativePath: 'A.cs', toRelativePath: 'B.cs', isDirectory: false },
      { kind: 'delete', relativePath: 'C.cs', isDirectory: false },
      { kind: 'create', relativePath: 'D', isDirectory: true }
    ])
  })

  it('ignores listing the scope root but relists when it moves or disappears', () => {
    expect(
      scopeTreeMutations('Game/Assets', [
        { kind: 'create', relativePath: 'Game', isDirectory: true },
        { kind: 'create', relativePath: 'Game/Assets', isDirectory: true }
      ])
    ).toEqual([])
    expect(
      scopeTreeMutations('Game/Assets', [
        { kind: 'delete', relativePath: 'Game', isDirectory: true }
      ])
    ).toBeNull()
    expect(
      scopeTreeMutations('Assets', [
        { kind: 'rename', fromRelativePath: 'Assets', toRelativePath: 'Assets2', isDirectory: true }
      ])
    ).toBeNull()
  })
})
