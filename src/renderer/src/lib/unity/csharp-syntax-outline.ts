import { lexCSharp, lookupOwn, significantCSharpTokens } from './csharp-lexer'
import { CSharpMemberParser } from './csharp-member-parser'
import type {
  CSharpAttribute,
  CSharpBaseType,
  CSharpMethod,
  CSharpOutline,
  CSharpTypeDeclaration
} from './csharp-syntax-outline-types'

const TYPE_KEYWORDS: Record<string, CSharpTypeDeclaration['kind']> = {
  class: 'class',
  struct: 'struct',
  interface: 'interface',
  record: 'record',
  enum: 'enum'
}

class OutlineParser extends CSharpMemberParser {
  readonly types: CSharpTypeDeclaration[] = []

  readonly usings: string[] = []

  /** Parse declarations from `index` until `end` (exclusive token index). */
  parseDeclarations(
    index: number,
    end: number,
    namespace: string | null,
    container: CSharpTypeDeclaration | null
  ): void {
    let i = index
    let currentNamespace = namespace
    while (i < end) {
      const token = this.tokens[i]
      if (token.text === 'using' && !container) {
        const semi = this.skipMember(i)
        const statement = this.tokens.slice(i + 1, semi - 1)
        const alias = statement.findIndex((t) => t.text === '=')
        const nameTokens = statement
          .slice(alias + 1)
          .filter((t) => t.kind === 'identifier' || t.text === '.')
        this.usings.push(nameTokens.map((t) => t.text).join(''))
        i = semi
        continue
      }
      if (token.text === 'namespace') {
        let j = i + 1
        let name = ''
        while (j < end && (this.isIdentifier(j) || this.is(j, '.'))) {
          name += this.tokens[j].text
          j++
        }
        const qualified = currentNamespace ? `${currentNamespace}.${name}` : name
        if (this.is(j, '{')) {
          const close = this.matching(j)
          this.parseDeclarations(j + 1, close, qualified, null)
          i = close + 1
        } else {
          currentNamespace = qualified
          i = j + 1
        }
        continue
      }
      const { attributes, next: afterAttributes } = this.parseAttributes(i)
      const { modifiers, next } = this.parseModifiers(afterAttributes)
      const typeKind = lookupOwn(TYPE_KEYWORDS, this.at(next)?.text ?? '')
      if (typeKind) {
        // `record class` / `record struct`
        const nameIndex =
          typeKind === 'record' && (this.is(next + 1, 'class') || this.is(next + 1, 'struct'))
            ? next + 2
            : next + 1
        if (this.isIdentifier(nameIndex)) {
          i = this.parseType(
            i,
            nameIndex,
            typeKind,
            modifiers,
            attributes,
            currentNamespace,
            container
          )
          continue
        }
      }
      if (container) {
        i = this.parseMember(i, next, modifiers, attributes, container)
        continue
      }
      i = Math.max(this.skipMember(next), i + 1)
    }
  }

  private parseType(
    declStart: number,
    nameIndex: number,
    kind: CSharpTypeDeclaration['kind'],
    modifiers: string[],
    attributes: CSharpAttribute[],
    namespace: string | null,
    container: CSharpTypeDeclaration | null
  ): number {
    const nameToken = this.tokens[nameIndex]
    let i = nameIndex + 1
    const afterTypeParams = this.skipTypeArguments(i)
    if (afterTypeParams !== -1) {
      i = afterTypeParams
    }
    if (this.is(i, '(')) {
      // Primary constructor parameters.
      i = this.matching(i) + 1
    }
    const baseTypes: CSharpBaseType[] = []
    if (this.is(i, ':')) {
      i++
      while (
        i < this.tokens.length &&
        !this.is(i, '{') &&
        !this.is(i, ';') &&
        this.at(i)?.text !== 'where'
      ) {
        const typeEnd = this.skipType(i)
        if (typeEnd === -1) {
          i++
          continue
        }
        let nameAt = i
        for (let j = i; j < typeEnd; j++) {
          if (this.isIdentifier(j)) {
            nameAt = j
          }
          if (this.is(j, '<')) {
            break
          }
        }
        baseTypes.push({
          name: this.tokens[nameAt].text,
          text: this.textOf(i, typeEnd),
          nameSpan: { start: this.tokens[nameAt].start, end: this.tokens[nameAt].end }
        })
        i = typeEnd
        if (this.is(i, '(')) {
          // Record base constructor arguments.
          i = this.matching(i) + 1
        }
        if (this.is(i, ',')) {
          i++
        }
      }
    }
    while (i < this.tokens.length && !this.is(i, '{') && !this.is(i, ';')) {
      i++
    }
    const declaration: CSharpTypeDeclaration = {
      kind,
      name: nameToken.text,
      nameSpan: { start: nameToken.start, end: nameToken.end },
      span: {
        start: this.tokens[declStart].start,
        end: this.tokens[Math.min(i, this.tokens.length - 1)].end
      },
      body: null,
      baseTypes,
      modifiers,
      attributes,
      members: [],
      nestedTypes: [],
      namespace,
      containingType: container
    }
    this.types.push(declaration)
    container?.nestedTypes.push(declaration)
    if (!this.is(i, '{')) {
      return i + 1
    }
    const close = this.matching(i)
    declaration.body = { start: this.tokens[i].start, end: this.tokens[close].end }
    declaration.span = { start: declaration.span.start, end: this.tokens[close].end }
    if (kind !== 'enum') {
      this.parseDeclarations(i + 1, close, namespace, declaration)
    }
    let after = close + 1
    if (this.is(after, ';')) {
      after++
    }
    return after
  }
}

export function parseCSharpOutline(text: string): CSharpOutline {
  const allTokens = lexCSharp(text)
  const tokens = significantCSharpTokens(allTokens)
  const parser = new OutlineParser(tokens)
  parser.parseDeclarations(0, tokens.length, null, null)
  return { text, tokens, allTokens, usings: parser.usings, types: parser.types }
}

export function methodsOf(type: CSharpTypeDeclaration): CSharpMethod[] {
  return type.members.filter((member): member is CSharpMethod => member.kind === 'method')
}

/** Innermost type declaration whose body contains `offset`. */
export function typeAtOffset(outline: CSharpOutline, offset: number): CSharpTypeDeclaration | null {
  let best: CSharpTypeDeclaration | null = null
  for (const type of outline.types) {
    if (type.body && type.body.start < offset && offset < type.body.end) {
      if (!best || type.body.start >= (best.body?.start ?? 0)) {
        best = type
      }
    }
  }
  return best
}
