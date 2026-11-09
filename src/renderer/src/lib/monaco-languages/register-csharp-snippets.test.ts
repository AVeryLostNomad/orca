import { describe, expect, it } from 'vitest'
import { csharpSnippetPreview, csharpSnippetsAllowedAfter } from './register-csharp-snippets'

describe('csharpSnippetsAllowedAfter', () => {
  it('offers snippets at statement and member starts', () => {
    expect(csharpSnippetsAllowedAfter('        ')).toBe(true)
    expect(csharpSnippetsAllowedAfter('    var s = "done"; ')).toBe(true)
  })

  it('suppresses them after member access and inside comments or strings', () => {
    expect(csharpSnippetsAllowedAfter('        transform.')).toBe(false)
    expect(csharpSnippetsAllowedAfter('        transform. ')).toBe(false)
    expect(csharpSnippetsAllowedAfter('    // loop ')).toBe(false)
    expect(csharpSnippetsAllowedAfter('    Debug.Log("value \\" ')).toBe(false)
  })
})

describe('csharpSnippetPreview', () => {
  it('fills nested defaults and repeats mirrored tab stops', () => {
    expect(csharpSnippetPreview('public ${1:${TM_FILENAME_BASE}}(${2})\n{\n\t$0\n}')).toBe(
      'public ClassName()\n{\n\t\n}'
    )
    expect(csharpSnippetPreview('for (int ${1:i} = 0; $1 < ${2:length}; $1++)')).toBe(
      'for (int i = 0; i < length; i++)'
    )
  })
})
