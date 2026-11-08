import { describe, expect, it } from 'vitest'
import { lexCSharp, significantCSharpTokens, tokenIndexAtCaret } from './csharp-lexer'

function significantTexts(source: string): string[] {
  return significantCSharpTokens(lexCSharp(source)).map((token) => token.text)
}

describe('lexCSharp', () => {
  it('keeps code-looking text inside comments and strings out of the code stream', () => {
    const source = [
      '// GetComponent<Rigidbody>();',
      '/* Update() { Find("x"); } */',
      'var s = "GetComponent<A>() // not a comment";',
      'var v = @"C:\\path ""quoted"" GetComponent";'
    ].join('\n')
    const texts = significantTexts(source)
    expect(texts).not.toContain('GetComponent')
    expect(texts.filter((text) => text === 'var')).toHaveLength(2)
  })

  it('decodes regular, verbatim and escaped literals', () => {
    const strings = lexCSharp('a("Pl\\"ay\\u0065r"); b(@"x""y");').filter(
      (token) => token.kind === 'string'
    )
    expect(strings.map((token) => token.value)).toEqual(['Pl"ayer', 'x"y'])
  })

  it('finds the end of interpolated strings whose holes contain quotes and braces', () => {
    const tokens = significantCSharpTokens(
      lexCSharp('x = $"{(a ? "}" : "{")} {d["k"]:N2}"; CompareTag("Player");')
    )
    const interpolated = tokens.find((token) => token.kind === 'string')
    expect(interpolated?.interpolated).toBe(true)
    expect(interpolated?.value).toBeUndefined()
    expect(tokens.map((token) => token.text)).toContain('CompareTag')
    expect(tokens.find((token) => token.value === 'Player')).toBeDefined()
  })

  it('handles raw string literals, including interpolated ones with multi-brace holes', () => {
    const source = 'var r = """\n    say "hi"\n    """; var q = $$"""{{x}} {"""; Find("a");'
    const tokens = significantCSharpTokens(lexCSharp(source))
    const strings = tokens.filter((token) => token.kind === 'string')
    expect(strings[0].value).toBe('say "hi"')
    expect(strings[1].interpolated).toBe(true)
    expect(strings[2].value).toBe('a')
  })

  it('treats `#` only at line start as a preprocessor directive and `@ident` as an identifier', () => {
    const tokens = lexCSharp('#if UNITY_EDITOR\nint @class = a#b;\n#endif')
    expect(tokens.filter((token) => token.kind === 'preprocessor')).toHaveLength(2)
    expect(tokens.find((token) => token.text === 'class')?.kind).toBe('identifier')
  })

  it('emits single `>` tokens so nested generic arguments close individually', () => {
    expect(significantTexts('List<List<int>> x;')).toEqual([
      'List',
      '<',
      'List',
      '<',
      'int',
      '>',
      '>',
      'x',
      ';'
    ])
  })

  it('treats the character literal quote escape as part of the literal', () => {
    expect(significantTexts("c = '\\''; d = '\"'; e();")).toEqual([
      'c',
      '=',
      "'\\''",
      ';',
      'd',
      '=',
      "'\"'",
      ';',
      'e',
      '(',
      ')',
      ';'
    ])
  })
})

describe('tokenIndexAtCaret', () => {
  it('reports the caret inside an unterminated string or after a line comment, not after closed literals', () => {
    const open = lexCSharp('CompareTag("Pla')
    expect(open[tokenIndexAtCaret(open, 15)]?.kind).toBe('string')
    const closed = lexCSharp('x("a")')
    expect(tokenIndexAtCaret(closed, 5)).toBe(-1)
    const comment = lexCSharp('// note')
    expect(comment[tokenIndexAtCaret(comment, 7)]?.kind).toBe('comment')
  })
})
