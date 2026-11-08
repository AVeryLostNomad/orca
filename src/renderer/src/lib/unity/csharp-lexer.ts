import { scanCharLiteral, scanStringLiteral } from './csharp-string-literals'

export type CSharpTokenKind =
  | 'identifier'
  | 'keyword'
  | 'number'
  | 'string'
  | 'char'
  | 'punct'
  | 'comment'
  | 'preprocessor'

export type CSharpToken = {
  kind: CSharpTokenKind
  /** Offset of the first character. */
  start: number
  /** Offset one past the last character. */
  end: number
  text: string
  /** Decoded value of non-interpolated string literals. */
  value?: string
  interpolated?: boolean
  /** False when the literal runs into a newline or end of input. */
  terminated?: boolean
}

const KEYWORDS: Record<string, true> = {
  abstract: true,
  as: true,
  base: true,
  bool: true,
  break: true,
  byte: true,
  case: true,
  catch: true,
  char: true,
  checked: true,
  class: true,
  const: true,
  continue: true,
  decimal: true,
  default: true,
  delegate: true,
  do: true,
  double: true,
  else: true,
  enum: true,
  event: true,
  explicit: true,
  extern: true,
  false: true,
  finally: true,
  fixed: true,
  float: true,
  for: true,
  foreach: true,
  goto: true,
  if: true,
  implicit: true,
  in: true,
  int: true,
  interface: true,
  internal: true,
  is: true,
  lock: true,
  long: true,
  namespace: true,
  new: true,
  null: true,
  object: true,
  operator: true,
  out: true,
  override: true,
  params: true,
  private: true,
  protected: true,
  public: true,
  readonly: true,
  ref: true,
  return: true,
  sbyte: true,
  sealed: true,
  short: true,
  sizeof: true,
  stackalloc: true,
  static: true,
  string: true,
  struct: true,
  switch: true,
  this: true,
  throw: true,
  true: true,
  try: true,
  typeof: true,
  uint: true,
  ulong: true,
  unchecked: true,
  unsafe: true,
  ushort: true,
  using: true,
  virtual: true,
  void: true,
  volatile: true,
  while: true
}

// Longest first; `<`/`>` stay single so nested generics (`List<List<int>>`) close correctly.
const MULTI_CHAR_PUNCT = [
  '??=',
  '=>',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '??',
  '?.',
  '::',
  '++',
  '--',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '->',
  '..'
]

const IDENT_START = /[\p{L}\p{Nl}_]/u
const IDENT_PART = /[\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}\p{Cf}]/u

/** Record lookup that ignores Object.prototype keys (`constructor` is a valid C# identifier). */
export function lookupOwn<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

function isLineStart(text: string, offset: number): boolean {
  for (let i = offset - 1; i >= 0; i--) {
    const ch = text[i]
    if (ch === '\n') {
      return true
    }
    if (ch !== ' ' && ch !== '\t' && ch !== '\r') {
      return false
    }
  }
  return true
}

function scanNumber(text: string, offset: number): number {
  let i = offset
  if (text[i] === '0' && /[xXbB]/.test(text[i + 1] ?? '')) {
    i += 2
    while (/[0-9a-fA-F_]/.test(text[i] ?? '')) {
      i++
    }
  } else {
    while (/[0-9_]/.test(text[i] ?? '')) {
      i++
    }
    if (text[i] === '.' && /[0-9]/.test(text[i + 1] ?? '')) {
      i++
      while (/[0-9_]/.test(text[i] ?? '')) {
        i++
      }
    }
    if (/[eE]/.test(text[i] ?? '') && /[0-9+-]/.test(text[i + 1] ?? '')) {
      i += 2
      while (/[0-9_]/.test(text[i] ?? '')) {
        i++
      }
    }
  }
  while (/[uUlLfFdDmM]/.test(text[i] ?? '')) {
    i++
  }
  return i
}

/** Tokenizes C# source, keeping comments and preprocessor lines as tokens so callers
 *  can tell where the caret sits; use `significantCSharpTokens` for analysis. */
export function lexCSharp(text: string): CSharpToken[] {
  const tokens: CSharpToken[] = []
  let i = 0
  const push = (
    kind: CSharpTokenKind,
    start: number,
    end: number,
    extra?: Partial<CSharpToken>
  ) => {
    tokens.push({ kind, start, end, text: text.slice(start, end), ...extra })
  }
  while (i < text.length) {
    const ch = text[i]
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === '\f' || ch === '\v') {
      i++
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      const newline = text.indexOf('\n', i)
      const end = newline === -1 ? text.length : newline
      push('comment', i, end)
      i = end
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      const end = close === -1 ? text.length : close + 2
      push('comment', i, end, { terminated: close !== -1 })
      i = end
      continue
    }
    if (ch === '#' && isLineStart(text, i)) {
      const newline = text.indexOf('\n', i)
      const end = newline === -1 ? text.length : newline
      push('preprocessor', i, end)
      i = end
      continue
    }
    if (ch === '"' || ((ch === '$' || ch === '@') && /[$@"]/.test(text[i + 1] ?? ''))) {
      const literal = scanStringLiteral(text, i)
      if (literal) {
        push('string', i, literal.end, {
          value: literal.value,
          interpolated: literal.interpolated,
          terminated: literal.terminated
        })
        i = literal.end
        continue
      }
    }
    if (ch === "'") {
      const literal = scanCharLiteral(text, i)
      push('char', i, literal.end, { terminated: literal.terminated })
      i = literal.end
      continue
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(text[i + 1] ?? ''))) {
      const end = scanNumber(text, i)
      push('number', i, end)
      i = end
      continue
    }
    const identStart = ch === '@' && IDENT_START.test(text[i + 1] ?? '') ? i + 1 : i
    if (IDENT_START.test(text[identStart] ?? '')) {
      let end = identStart + 1
      while (end < text.length && IDENT_PART.test(text[end])) {
        end++
      }
      const word = text.slice(identStart, end)
      // `@class` is an identifier named `class`.
      const kind = identStart === i && lookupOwn(KEYWORDS, word) ? 'keyword' : 'identifier'
      tokens.push({ kind, start: i, end, text: word })
      i = end
      continue
    }
    const multi = MULTI_CHAR_PUNCT.find((op) => text.startsWith(op, i))
    const end = i + (multi?.length ?? 1)
    push('punct', i, end)
    i = end
  }
  return tokens
}

export function significantCSharpTokens(tokens: CSharpToken[]): CSharpToken[] {
  return tokens.filter((token) => token.kind !== 'comment' && token.kind !== 'preprocessor')
}

/** Index of the token the caret at `offset` sits inside, else -1. A caret right after a
 *  token counts only when that token is still open (unterminated literal, `//` comment). */
export function tokenIndexAtCaret(tokens: CSharpToken[], offset: number): number {
  let low = 0
  let high = tokens.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const token = tokens[mid]
    if (token.end < offset) {
      low = mid + 1
    } else if (token.start >= offset) {
      high = mid - 1
    } else if (offset < token.end) {
      return mid
    } else {
      const lineComment = token.kind === 'comment' && token.text.startsWith('//')
      return token.terminated === false || lineComment ? mid : -1
    }
  }
  return -1
}
