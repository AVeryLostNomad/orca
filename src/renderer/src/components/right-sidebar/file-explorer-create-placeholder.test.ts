import { describe, expect, it } from 'vitest'
import { getCreatePlaceholderRelativePath } from './file-explorer-create-placeholder'

describe('getCreatePlaceholderRelativePath', () => {
  it('uses the base name at the worktree root when free', () => {
    expect(getCreatePlaceholderRelativePath('', () => false)).toBe('untitled')
  })

  it('prefixes the parent directory', () => {
    expect(getCreatePlaceholderRelativePath('src/nested', () => false)).toBe('src/nested/untitled')
  })

  it('skips taken names with a numeric suffix', () => {
    const taken = new Set(['untitled', 'untitled-2'])
    expect(getCreatePlaceholderRelativePath('', (path) => taken.has(path))).toBe('untitled-3')
  })

  it('gives up when every candidate collides', () => {
    expect(getCreatePlaceholderRelativePath('', () => true)).toBeNull()
  })
})
