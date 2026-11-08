import { lookupOwn, type CSharpToken } from './csharp-lexer'
import type { CSharpAttribute, CSharpSpan } from './csharp-syntax-outline-types'

const MODIFIERS: Record<string, true> = {
  public: true,
  private: true,
  protected: true,
  internal: true,
  static: true,
  readonly: true,
  const: true,
  volatile: true,
  virtual: true,
  override: true,
  abstract: true,
  sealed: true,
  extern: true,
  unsafe: true,
  new: true,
  async: true,
  partial: true,
  required: true,
  fixed: true,
  file: true
}

export const CLOSERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' }

/** Token navigation shared by the outline's declaration and member parsers. */
export class CSharpTokenCursor {
  constructor(protected readonly tokens: CSharpToken[]) {}

  protected at(index: number): CSharpToken | undefined {
    return this.tokens[index]
  }

  protected is(index: number, text: string): boolean {
    const token = this.tokens[index]
    return token !== undefined && token.text === text && token.kind !== 'string'
  }

  protected isIdentifier(index: number): boolean {
    return this.tokens[index]?.kind === 'identifier'
  }

  /** Index of the token closing the bracket at `index`, or the last token when unbalanced. */
  matching(index: number): number {
    const stack: string[] = []
    for (let i = index; i < this.tokens.length; i++) {
      const token = this.tokens[i]
      if (token.kind !== 'punct') {
        continue
      }
      const closer = lookupOwn(CLOSERS, token.text)
      if (closer) {
        stack.push(closer)
      } else if (token.text === ')' || token.text === ']' || token.text === '}') {
        // Recover from stray closers by popping to the nearest matching opener.
        const at = stack.lastIndexOf(token.text)
        if (at === -1) {
          if (token.text === '}') {
            return i - 1
          }
          continue
        }
        stack.length = at
        if (stack.length === 0) {
          return i
        }
      }
    }
    return this.tokens.length - 1
  }

  /** Index past a balanced `<...>` type-argument list starting at `index`, or -1. */
  skipTypeArguments(index: number): number {
    if (!this.is(index, '<')) {
      return -1
    }
    let depth = 0
    for (let i = index; i < this.tokens.length; i++) {
      const token = this.tokens[i]
      if (token.text === '<') {
        depth++
      } else if (token.text === '>') {
        depth--
        if (depth === 0) {
          return i + 1
        }
      } else if (token.text === '(' || token.text === '[') {
        i = this.matching(i)
      } else if (
        token.kind !== 'identifier' &&
        token.kind !== 'keyword' &&
        !(token.kind === 'punct' && /^(?:[.,?*]|::)$/.test(token.text))
      ) {
        return -1
      }
    }
    return -1
  }

  /** Index past a type starting at `index`, or -1 when no type starts there. */
  skipType(index: number): number {
    let i = index
    if (this.is(i, '(')) {
      // Tuple type.
      i = this.matching(i) + 1
    } else if (this.isIdentifier(i) || this.at(i)?.kind === 'keyword') {
      const token = this.at(i)
      if (token?.kind === 'keyword' && lookupOwn(MODIFIERS, token.text)) {
        return -1
      }
      i++
      for (;;) {
        const afterArgs = this.skipTypeArguments(i)
        if (afterArgs !== -1) {
          i = afterArgs
        }
        if ((this.is(i, '.') || this.is(i, '::')) && this.isIdentifier(i + 1)) {
          i += 2
          continue
        }
        break
      }
    } else {
      return -1
    }
    for (;;) {
      if (this.is(i, '?') || this.is(i, '*')) {
        i++
      } else if (this.is(i, '[') && (this.is(i + 1, ']') || this.is(i + 1, ','))) {
        i = this.matching(i) + 1
      } else {
        return i
      }
    }
  }

  protected textOf(from: number, toExclusive: number): string {
    let out = ''
    for (let i = from; i < toExclusive; i++) {
      const token = this.tokens[i]
      out += token.text
      if (token.text === ',') {
        out += ' '
      }
    }
    return out
  }

  protected spanOf(from: number, toInclusive: number): CSharpSpan {
    return { start: this.tokens[from].start, end: this.tokens[toInclusive].end }
  }

  parseAttributes(index: number): { attributes: CSharpAttribute[]; next: number } {
    const attributes: CSharpAttribute[] = []
    let i = index
    while (this.is(i, '[')) {
      const close = this.matching(i)
      let j = i + 1
      let target: string | undefined
      if ((this.isIdentifier(j) || this.at(j)?.kind === 'keyword') && this.is(j + 1, ':')) {
        target = this.at(j)?.text
        j += 2
      }
      while (j < close) {
        let name: string | undefined
        while (j < close && !this.is(j, ',') && !this.is(j, '(')) {
          if (this.isIdentifier(j)) {
            name = this.at(j)?.text
          }
          j++
        }
        if (this.is(j, '(')) {
          j = this.matching(j) + 1
        }
        if (name) {
          attributes.push({ name: name.replace(/Attribute$/, ''), target })
        }
        if (this.is(j, ',')) {
          j++
        }
      }
      i = close + 1
    }
    return { attributes, next: i }
  }

  parseModifiers(index: number): { modifiers: string[]; next: number } {
    const modifiers: string[] = []
    let i = index
    for (;;) {
      const token = this.at(i)
      if (!token || !lookupOwn(MODIFIERS, token.text)) {
        break
      }
      // Contextual modifiers (`partial`, `async`, `required`, `file`) are only modifiers when
      // another declaration token follows; `async Task Foo()` vs a type named `async` is moot.
      if (
        token.kind === 'identifier' &&
        !(this.isIdentifier(i + 1) || this.at(i + 1)?.kind === 'keyword')
      ) {
        break
      }
      modifiers.push(token.text)
      i++
    }
    return { modifiers, next: i }
  }

  /** Skip a statement-ish run to the next `;` or balanced block at this level. */
  protected skipMember(index: number): number {
    for (let i = index; i < this.tokens.length; i++) {
      const token = this.tokens[i]
      if (token.text === ';') {
        return i + 1
      }
      if (token.text === '{') {
        const close = this.matching(i)
        // `{ get; } = value;` style initializers.
        if (this.is(close + 1, '=') || this.is(close + 1, ';')) {
          continue
        }
        return close + 1
      }
      if (token.text === '(' || token.text === '[') {
        i = this.matching(i)
      } else if (token.text === '}') {
        return i
      }
    }
    return this.tokens.length
  }
}
