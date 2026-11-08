import { describe, expect, it } from 'vitest'
import { canonicalLspUri, lspUriFromPath, pathFromLspUri } from './lsp-file-uri'

describe('lspUriFromPath', () => {
  it('encodes posix paths', () => {
    expect(lspUriFromPath('/Users/dev/repo/src/main.ts', 'typescript')).toBe(
      'file:///Users/dev/repo/src/main.ts'
    )
  })

  it('percent-encodes Windows drive letters the LSP way', () => {
    expect(lspUriFromPath('c:/repo/src/main.ts', 'typescript')).toBe(
      'file:///c%3A/repo/src/main.ts'
    )
  })

  it('encodes spaces and unicode', () => {
    expect(lspUriFromPath('/tmp/my project/héllo.ts', 'typescript')).toBe(
      'file:///tmp/my%20project/h%C3%A9llo.ts'
    )
  })

  it('leaves the drive colon unencoded for Roslyn, yet compares equal to the encoded form', () => {
    const roslynUri = lspUriFromPath('C:/Unity/Game/Assets/Piece.cs', 'csharp')
    expect(roslynUri).toBe('file:///c:/Unity/Game/Assets/Piece.cs')
    expect(canonicalLspUri(roslynUri)).toBe(
      canonicalLspUri(lspUriFromPath('C:/Unity/Game/Assets/Piece.cs', 'typescript'))
    )
    // Roslyn echoes upper-case drives in some responses.
    expect(canonicalLspUri('file:///C:/Unity/Game/Assets/Piece.cs')).toBe(
      canonicalLspUri(roslynUri)
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
