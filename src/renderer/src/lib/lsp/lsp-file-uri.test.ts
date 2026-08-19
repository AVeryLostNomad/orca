import { describe, expect, it } from 'vitest'
import { lspUriFromPath, pathFromLspUri } from './lsp-file-uri'

describe('lspUriFromPath', () => {
  it('encodes posix paths', () => {
    expect(lspUriFromPath('/Users/dev/repo/src/main.ts')).toBe('file:///Users/dev/repo/src/main.ts')
  })

  it('percent-encodes Windows drive letters the LSP way', () => {
    expect(lspUriFromPath('c:/repo/src/main.ts')).toBe('file:///c%3A/repo/src/main.ts')
  })

  it('encodes spaces and unicode', () => {
    expect(lspUriFromPath('/tmp/my project/héllo.ts')).toBe(
      'file:///tmp/my%20project/h%C3%A9llo.ts'
    )
  })
})

describe('pathFromLspUri', () => {
  it('round-trips posix paths', () => {
    expect(pathFromLspUri('file:///Users/dev/repo/src/main.ts')).toBe('/Users/dev/repo/src/main.ts')
  })

  it('rejects non-file schemes and garbage', () => {
    expect(pathFromLspUri('untitled:Untitled-1')).toBeNull()
  })
})
