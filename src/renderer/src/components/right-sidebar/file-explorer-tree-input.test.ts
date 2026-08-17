import { describe, expect, it } from 'vitest'
import {
  buildFileExplorerTreeGitStatus,
  buildFileExplorerTreeInputPaths
} from './file-explorer-tree-input'
import type { GitStatusEntry } from '../../../../shared/git-status-types'

describe('buildFileExplorerTreeInputPaths', () => {
  const filters = { showDotfiles: true, showGitIgnoredFiles: true, ignoredSet: new Set<string>() }

  it('normalizes separators and dedupes', () => {
    expect(buildFileExplorerTreeInputPaths(['src\\a.ts', 'src/a.ts', 'src/b.ts'], filters)).toEqual(
      ['src/a.ts', 'src/b.ts']
    )
  })

  it('filters dotfile paths when hidden', () => {
    expect(
      buildFileExplorerTreeInputPaths(['.github/ci.yml', 'src/.env', 'src/a.ts'], {
        ...filters,
        showDotfiles: false
      })
    ).toEqual(['src/a.ts'])
  })

  it('filters gitignored paths and their descendants when hidden', () => {
    expect(
      buildFileExplorerTreeInputPaths(['dist/bundle.js', 'dist/x/y.js', 'src/a.ts'], {
        ...filters,
        showGitIgnoredFiles: false,
        ignoredSet: new Set(['dist'])
      })
    ).toEqual(['src/a.ts'])
  })
})

describe('buildFileExplorerTreeGitStatus', () => {
  const entry = (path: string, status: GitStatusEntry['status']): GitStatusEntry => ({
    path,
    status,
    area: 'unstaged'
  })

  it('maps statuses, folding copied into added', () => {
    expect(
      buildFileExplorerTreeGitStatus(
        [entry('a.ts', 'modified'), entry('b.ts', 'copied'), entry('c.ts', 'untracked')],
        []
      )
    ).toEqual([
      { path: 'a.ts', status: 'modified' },
      { path: 'b.ts', status: 'added' },
      { path: 'c.ts', status: 'untracked' }
    ])
  })

  it('resolves duplicate paths to the dominant status', () => {
    expect(
      buildFileExplorerTreeGitStatus([entry('a.ts', 'renamed'), entry('a.ts', 'modified')], [])
    ).toEqual([{ path: 'a.ts', status: 'modified' }])
  })

  it('marks visible ignored paths without clobbering real statuses', () => {
    expect(
      buildFileExplorerTreeGitStatus([entry('a.ts', 'modified')], ['a.ts', 'dist/bundle.js'])
    ).toEqual([
      { path: 'a.ts', status: 'modified' },
      { path: 'dist/bundle.js', status: 'ignored' }
    ])
  })
})
