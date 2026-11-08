import { lookupOwn, type CSharpToken } from './csharp-lexer'

export type CSharpInvocation = {
  name: string
  /** Token index of the invoked member name. */
  nameIndex: number
  /** Dotted receiver chain as written (`GameObject`, `this`, `a.b`), `(expr)` for complex
   *  receivers, or null when unqualified. */
  receiver: string | null
  typeArguments: string[]
  openParen: number
  /** Index of the closing `)`, or the range end for a call still being typed. */
  closeParen: number
  /** Token index ranges [from, to) of each top-level argument. */
  args: { from: number; to: number }[]
}

export type CSharpMemberAccess = {
  name: string
  nameIndex: number
  receiver: string
}

const OPENERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' }

function closingIndex(tokens: CSharpToken[], open: number, limit: number): number {
  let depth = 0
  for (let i = open; i < limit; i++) {
    const token = tokens[i]
    if (token.kind !== 'punct') {
      continue
    }
    if (Object.hasOwn(OPENERS, token.text)) {
      depth++
    } else if (token.text === ')' || token.text === ']' || token.text === '}') {
      depth--
      if (depth === 0) {
        return i
      }
    }
  }
  // Unclosed call while typing: its arguments run to the end of the range.
  return limit
}

/** Index after a generic argument list at `open`, when it is followed by `(`; else -1. */
function genericInvocationEnd(tokens: CSharpToken[], open: number, limit: number): number {
  let depth = 0
  for (let i = open; i < limit; i++) {
    const token = tokens[i]
    if (token.text === '<') {
      depth++
    } else if (token.text === '>') {
      depth--
      if (depth === 0) {
        return tokens[i + 1]?.text === '(' ? i + 1 : -1
      }
    } else if (
      token.kind !== 'identifier' &&
      token.kind !== 'keyword' &&
      !(token.kind === 'punct' && /^(?:[.,?[\]]|::)$/.test(token.text))
    ) {
      return -1
    }
  }
  return -1
}

/** Walks back from the `.` before a member to the start of its receiver chain. */
function receiverText(tokens: CSharpToken[], dotIndex: number, floor: number): string {
  const parts: string[] = []
  let i = dotIndex - 1
  while (i >= floor) {
    const token = tokens[i]
    if (token.kind === 'identifier' || token.text === 'this' || token.text === 'base') {
      parts.unshift(token.text)
      if ((tokens[i - 1]?.text === '.' || tokens[i - 1]?.text === '?.') && i - 1 > floor) {
        parts.unshift('.')
        i -= 2
        continue
      }
      break
    }
    if (token.text === ')' || token.text === ']' || token.text === '>') {
      parts.unshift('(expr)')
      break
    }
    if (token.kind === 'string') {
      parts.unshift('(expr)')
      break
    }
    break
  }
  return parts.join('') || '(expr)'
}

// Contextual keywords lex as identifiers yet may precede an invocation expression.
const EXPRESSION_PREFIX_WORDS: Record<string, true> = {
  await: true,
  yield: true,
  when: true,
  select: true,
  where: true,
  orderby: true,
  let: true,
  by: true,
  into: true,
  on: true,
  equals: true,
  and: true,
  or: true,
  not: true,
  with: true,
  ascending: true,
  descending: true
}

/** True when the token before an identifier makes `ident(` a declaration (`void Foo(`,
 *  `List<int> Foo(`, `int[] Foo(`) or a construction (`new Foo(`) rather than a call. */
function isDeclarationOrConstruction(tokens: CSharpToken[], previousIndex: number): boolean {
  const previous = tokens[previousIndex]
  if (previous.text === 'new' || previous.text === ']') {
    return true
  }
  if (previous.kind === 'identifier') {
    return !lookupOwn(EXPRESSION_PREFIX_WORDS, previous.text)
  }
  if (previous.kind === 'keyword') {
    return /^(?:void|int|bool|float|double|string|object|long|byte|char|short|uint|ulong|ushort|sbyte|decimal)$/.test(
      previous.text
    )
  }
  if (previous.text !== '>') {
    return false
  }
  // `List<int> Foo(` closes a type-argument list; `a > Foo(` is a comparison.
  let depth = 0
  for (let i = previousIndex; i >= 0; i--) {
    const token = tokens[i]
    if (token.text === '>') {
      depth++
    } else if (token.text === '<') {
      depth--
      if (depth === 0) {
        return tokens[i - 1]?.kind === 'identifier'
      }
    } else if (
      token.kind !== 'identifier' &&
      token.kind !== 'keyword' &&
      !/^(?:[.,?[\]]|::)$/.test(token.text)
    ) {
      return false
    }
  }
  return false
}

/** Every `name(...)` / `name<T>(...)` invocation within tokens [from, to). Declarations
 *  (`void Foo(`) and `new T(` are excluded. */
export function findCSharpInvocations(
  tokens: CSharpToken[],
  from: number,
  to: number
): CSharpInvocation[] {
  const invocations: CSharpInvocation[] = []
  for (let i = from; i < to; i++) {
    const token = tokens[i]
    if (token.kind !== 'identifier') {
      continue
    }
    let openParen = -1
    const typeArguments: string[] = []
    if (tokens[i + 1]?.text === '(') {
      openParen = i + 1
    } else if (tokens[i + 1]?.text === '<') {
      openParen = genericInvocationEnd(tokens, i + 1, to)
      if (openParen !== -1) {
        let current = ''
        for (let j = i + 2; j < openParen - 1; j++) {
          if (tokens[j].text === ',') {
            typeArguments.push(current)
            current = ''
          } else {
            current += tokens[j].text
          }
        }
        typeArguments.push(current)
      }
    }
    if (openParen === -1 || openParen >= to) {
      continue
    }
    const previous = tokens[i - 1]
    if (previous && isDeclarationOrConstruction(tokens, i - 1)) {
      continue
    }
    const qualified = previous && (previous.text === '.' || previous.text === '?.')
    const closeParen = closingIndex(tokens, openParen, to)
    const args: CSharpInvocation['args'] = []
    let argStart = openParen + 1
    let depth = 0
    for (let j = openParen + 1; j < closeParen; j++) {
      const text = tokens[j].text
      if (tokens[j].kind === 'punct' && Object.hasOwn(OPENERS, text)) {
        depth++
      } else if (tokens[j].kind === 'punct' && (text === ')' || text === ']' || text === '}')) {
        depth--
      } else if (text === ',' && depth === 0 && tokens[j].kind === 'punct') {
        args.push({ from: argStart, to: j })
        argStart = j + 1
      }
    }
    if (argStart < closeParen) {
      args.push({ from: argStart, to: closeParen })
    }
    invocations.push({
      name: token.text,
      nameIndex: i,
      receiver: qualified ? receiverText(tokens, i - 1, from) : null,
      typeArguments,
      openParen,
      closeParen,
      args
    })
  }
  return invocations
}

/** `receiver.name` accesses that are not invocations (properties/fields such as `Camera.main`). */
export function findCSharpMemberAccesses(
  tokens: CSharpToken[],
  from: number,
  to: number
): CSharpMemberAccess[] {
  const accesses: CSharpMemberAccess[] = []
  for (let i = from + 1; i < to; i++) {
    const token = tokens[i]
    const previous = tokens[i - 1]
    if (token.kind !== 'identifier' || (previous.text !== '.' && previous.text !== '?.')) {
      continue
    }
    const next = tokens[i + 1]?.text
    if (next === '(' || next === '<') {
      continue
    }
    accesses.push({ name: token.text, nameIndex: i, receiver: receiverText(tokens, i - 1, from) })
  }
  return accesses
}

/** Last dotted segment of a receiver (`UnityEngine.GameObject` → `GameObject`). */
export function receiverSimpleName(receiver: string | null): string | null {
  if (receiver === null) {
    return null
  }
  const dot = receiver.lastIndexOf('.')
  return dot === -1 ? receiver : receiver.slice(dot + 1)
}
