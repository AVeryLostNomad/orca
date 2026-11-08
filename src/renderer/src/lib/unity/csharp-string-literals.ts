// String, verbatim, interpolated and raw literal scanning for the C# lexer.

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '0': '\0',
  a: '\x07',
  b: '\b',
  f: '\f',
  v: '\v',
  e: '\x1b',
  '\\': '\\',
  "'": "'",
  '"': '"'
}

function countRun(text: string, offset: number, ch: string): number {
  let count = 0
  while (text[offset + count] === ch) {
    count++
  }
  return count
}

/** Index after an escape sequence starting at the backslash. */
function skipEscape(text: string, offset: number): { end: number; decoded: string } {
  const next = text[offset + 1]
  if (next === undefined) {
    return { end: offset + 1, decoded: '' }
  }
  if (next === 'u' || next === 'x' || next === 'U') {
    const maxDigits = next === 'U' ? 8 : 4
    let end = offset + 2
    while (end - offset - 2 < maxDigits && /[0-9a-fA-F]/.test(text[end] ?? '')) {
      end++
    }
    const code = Number.parseInt(text.slice(offset + 2, end), 16)
    return { end, decoded: Number.isNaN(code) ? '' : String.fromCodePoint(code) }
  }
  return { end: offset + 2, decoded: Object.hasOwn(ESCAPES, next) ? ESCAPES[next] : next }
}

/** End offset of an interpolation hole `{...}` opened at `offset` (pointing past the braces). */
function skipInterpolationHole(text: string, offset: number, closeBraces: number): number {
  let depth = 0
  let i = offset
  while (i < text.length) {
    const ch = text[i]
    if (ch === '"' || ch === '@' || ch === '$') {
      const literal = scanStringLiteral(text, i)
      if (literal) {
        i = literal.end
        continue
      }
    }
    if (ch === "'") {
      i = scanCharLiteral(text, i).end
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      // A `//` inside a single-line hole ends the string in practice; stop at the newline.
      while (i < text.length && text[i] !== '\n') {
        i++
      }
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      i = close === -1 ? text.length : close + 2
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++
    } else if (ch === ')' || ch === ']') {
      depth--
    } else if (ch === '}') {
      if (depth === 0) {
        return i + Math.min(closeBraces, countRun(text, i, '}'))
      }
      depth--
    }
    i++
  }
  return i
}

export type ScannedLiteral = {
  end: number
  value?: string
  interpolated: boolean
  terminated: boolean
}

export function scanCharLiteral(text: string, offset: number): ScannedLiteral {
  let i = offset + 1
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\') {
      i = skipEscape(text, i).end
      continue
    }
    if (ch === "'") {
      return { end: i + 1, interpolated: false, terminated: true }
    }
    if (ch === '\n') {
      return { end: i, interpolated: false, terminated: false }
    }
    i++
  }
  return { end: i, interpolated: false, terminated: false }
}

/** Scans any string literal form starting at `offset`, or null when none starts there. */
export function scanStringLiteral(text: string, offset: number): ScannedLiteral | null {
  let i = offset
  let dollars = 0
  let verbatim = false
  while (text[i] === '$' || text[i] === '@') {
    if (text[i] === '$') {
      dollars++
    } else {
      if (verbatim) {
        return null
      }
      verbatim = true
    }
    i++
  }
  if (text[i] !== '"' || (dollars > 0 && verbatim && dollars > 1)) {
    return null
  }
  const interpolated = dollars > 0
  const quotes = countRun(text, i, '"')
  if (!verbatim && quotes >= 3) {
    return scanRawString(text, i, quotes, dollars)
  }
  i++
  let value = ''
  while (i < text.length) {
    const ch = text[i]
    if (verbatim) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          value += '"'
          i += 2
          continue
        }
        return {
          end: i + 1,
          value: interpolated ? undefined : value,
          interpolated,
          terminated: true
        }
      }
    } else {
      if (ch === '\n') {
        return { end: i, value: interpolated ? undefined : value, interpolated, terminated: false }
      }
      if (ch === '\\') {
        const escape = skipEscape(text, i)
        value += escape.decoded
        i = escape.end
        continue
      }
      if (ch === '"') {
        return {
          end: i + 1,
          value: interpolated ? undefined : value,
          interpolated,
          terminated: true
        }
      }
    }
    if (interpolated && ch === '{') {
      if (text[i + 1] === '{') {
        i += 2
        continue
      }
      i = skipInterpolationHole(text, i + 1, 1)
      continue
    }
    value += ch
    i++
  }
  return { end: i, value: interpolated ? undefined : value, interpolated, terminated: false }
}

function scanRawString(
  text: string,
  quoteStart: number,
  quotes: number,
  dollars: number
): ScannedLiteral {
  let i = quoteStart + quotes
  const contentStart = i
  while (i < text.length) {
    if (text[i] === '"') {
      const run = countRun(text, i, '"')
      if (run >= quotes) {
        const raw = text.slice(contentStart, i)
        return {
          end: i + run,
          value: dollars > 0 ? undefined : normalizeRawStringContent(raw),
          interpolated: dollars > 0,
          terminated: true
        }
      }
      i += run
      continue
    }
    if (dollars > 0 && text[i] === '{' && countRun(text, i, '{') >= dollars) {
      i = skipInterpolationHole(text, i + countRun(text, i, '{'), dollars)
      continue
    }
    i++
  }
  return { end: i, interpolated: dollars > 0, terminated: false }
}

// Multi-line raw strings drop the first/last line and the closing line's indentation.
function normalizeRawStringContent(raw: string): string {
  if (!raw.includes('\n')) {
    return raw
  }
  const lines = raw.split(/\r?\n/)
  const closingLine = lines.at(-1) ?? ''
  const indent = /^[ \t]*$/.test(closingLine) ? closingLine : ''
  return lines
    .slice(1, -1)
    .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line))
    .join('\n')
}
