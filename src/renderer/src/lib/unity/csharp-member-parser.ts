import { lookupOwn } from './csharp-lexer'
import type {
  CSharpAttribute,
  CSharpField,
  CSharpMethod,
  CSharpOtherMember,
  CSharpParameter,
  CSharpTypeDeclaration
} from './csharp-syntax-outline-types'
import { CLOSERS, CSharpTokenCursor } from './csharp-token-cursor'

const PARAMETER_MODIFIERS: Record<string, NonNullable<CSharpParameter['modifier']>> = {
  ref: 'ref',
  out: 'out',
  in: 'in',
  params: 'params',
  this: 'this',
  scoped: 'scoped'
}

/** Parses the members (methods, fields, properties) of a type body. */
export class CSharpMemberParser extends CSharpTokenCursor {
  protected parseMember(
    declStart: number,
    index: number,
    modifiers: string[],
    attributes: CSharpAttribute[],
    container: CSharpTypeDeclaration
  ): number {
    const token = this.at(index)
    if (!token) {
      return index + 1
    }
    const fallback = (kind: CSharpOtherMember['kind']): number => {
      const end = Math.max(this.skipMember(index), index + 1)
      container.members.push({
        kind,
        span: this.spanOf(declStart, Math.min(end, this.tokens.length) - 1),
        bodyTokens: this.blockTokensWithin(index, end)
      })
      return end
    }
    if (
      token.text === 'event' ||
      token.text === 'delegate' ||
      token.text === '~' ||
      token.text === 'implicit' ||
      token.text === 'explicit' ||
      token.text === ';'
    ) {
      return fallback('other')
    }
    if (this.isIdentifier(index) && token.text === container.name && this.is(index + 1, '(')) {
      return fallback('constructor')
    }
    const typeEnd = this.skipType(index)
    if (typeEnd === -1) {
      return fallback('other')
    }
    if (this.is(typeEnd, 'operator') || this.is(typeEnd, 'this')) {
      return fallback('other')
    }
    // Member name, possibly an explicit interface implementation (`IFoo.Bar`).
    let nameIndex = typeEnd
    if (!this.isIdentifier(nameIndex)) {
      return fallback('other')
    }
    while (this.is(nameIndex + 1, '.') && this.isIdentifier(nameIndex + 2)) {
      nameIndex += 2
    }
    const nameToken = this.tokens[nameIndex]
    let i = nameIndex + 1
    const typeParameters: string[] = []
    const afterTypeParams = this.skipTypeArguments(i)
    if (afterTypeParams !== -1 && this.is(afterTypeParams, '(')) {
      for (let j = i + 1; j < afterTypeParams - 1; j++) {
        if (this.isIdentifier(j)) {
          typeParameters.push(this.tokens[j].text)
        }
      }
      i = afterTypeParams
    }
    if (this.is(i, '(')) {
      return this.parseMethod(
        declStart,
        index,
        typeEnd,
        nameIndex,
        i,
        modifiers,
        attributes,
        typeParameters,
        container
      )
    }
    if (this.is(i, '{') || this.is(i, '=>')) {
      const end = Math.max(this.skipMember(i), i + 1)
      let auto = false
      if (this.is(i, '{')) {
        const close = this.matching(i)
        auto = this.tokens.slice(i + 1, close).every((t) => t.kind !== 'punct' || t.text === ';')
      }
      container.members.push({
        kind: 'property',
        type: this.textOf(index, typeEnd),
        name: nameToken.text,
        nameSpan: { start: nameToken.start, end: nameToken.end },
        span: this.spanOf(declStart, Math.min(end, this.tokens.length) - 1),
        modifiers,
        attributes,
        auto
      })
      return end
    }
    if (this.is(i, '=') || this.is(i, ',') || this.is(i, ';') || this.is(i, '[')) {
      return this.parseField(declStart, index, typeEnd, modifiers, attributes, container)
    }
    return fallback('other')
  }

  private blockTokensWithin(
    from: number,
    toExclusive: number
  ): { from: number; to: number } | null {
    for (let i = from; i < toExclusive; i++) {
      if (this.is(i, '{') || this.is(i, '=>')) {
        return { from: i, to: toExclusive }
      }
    }
    return null
  }

  private parseField(
    declStart: number,
    typeStart: number,
    typeEnd: number,
    modifiers: string[],
    attributes: CSharpAttribute[],
    container: CSharpTypeDeclaration
  ): number {
    const names: CSharpField['names'] = []
    let i = typeEnd
    while (i < this.tokens.length) {
      if (this.isIdentifier(i)) {
        names.push({
          name: this.tokens[i].text,
          span: { start: this.tokens[i].start, end: this.tokens[i].end }
        })
        i++
      }
      // Skip initializer / fixed-buffer size to the next declarator or the end.
      while (i < this.tokens.length && !this.is(i, ',') && !this.is(i, ';') && !this.is(i, '}')) {
        const text = this.tokens[i].text
        i =
          lookupOwn(CLOSERS, text) && this.tokens[i].kind === 'punct' ? this.matching(i) + 1 : i + 1
      }
      if (this.is(i, ',')) {
        i++
        continue
      }
      break
    }
    const end = this.is(i, ';') ? i + 1 : i
    container.members.push({
      kind: 'field',
      type: this.textOf(typeStart, typeEnd),
      names,
      span: this.spanOf(declStart, Math.max(declStart, Math.min(end, this.tokens.length) - 1)),
      modifiers,
      attributes
    })
    return Math.max(end, typeEnd + 1)
  }

  private parseMethod(
    declStart: number,
    typeStart: number,
    typeEnd: number,
    nameIndex: number,
    openParen: number,
    modifiers: string[],
    attributes: CSharpAttribute[],
    typeParameters: string[],
    container: CSharpTypeDeclaration
  ): number {
    const closeParen = this.matching(openParen)
    const parameters: CSharpParameter[] = []
    let j = openParen + 1
    while (j < closeParen) {
      const paramStart = j
      const { next: afterAttrs } = this.parseAttributes(j)
      j = afterAttrs
      let modifier: CSharpParameter['modifier']
      // `ref readonly` and `scoped ref` collapse to their first modifier.
      while (
        j < closeParen &&
        (lookupOwn(PARAMETER_MODIFIERS, this.tokens[j].text) || this.is(j, 'readonly'))
      ) {
        modifier = modifier ?? lookupOwn(PARAMETER_MODIFIERS, this.tokens[j].text)
        j++
      }
      const pTypeEnd = this.skipType(j)
      let type = ''
      let name = ''
      if (pTypeEnd !== -1 && pTypeEnd <= closeParen) {
        type = this.textOf(j, pTypeEnd)
        if (this.isIdentifier(pTypeEnd)) {
          name = this.tokens[pTypeEnd].text
        }
        j = pTypeEnd + (name ? 1 : 0)
      }
      let hasDefault = false
      while (j < closeParen && !this.is(j, ',')) {
        if (this.is(j, '=')) {
          hasDefault = true
        }
        const text = this.tokens[j].text
        j =
          lookupOwn(CLOSERS, text) && this.tokens[j].kind === 'punct' ? this.matching(j) + 1 : j + 1
      }
      parameters.push({
        type,
        name,
        modifier,
        hasDefault,
        span: this.spanOf(paramStart, Math.max(paramStart, Math.min(j, closeParen) - 1))
      })
      if (this.is(j, ',')) {
        j++
      }
    }
    let i = closeParen + 1
    // Skip `where` constraints and base/this constructor initializers.
    while (
      i < this.tokens.length &&
      !this.is(i, '{') &&
      !this.is(i, '=>') &&
      !this.is(i, ';') &&
      !this.is(i, '}')
    ) {
      i = this.is(i, '(') ? this.matching(i) + 1 : i + 1
    }
    let body: CSharpMethod['body'] = null
    let bodyTokens: CSharpMethod['bodyTokens'] = null
    let end = i
    if (this.is(i, '{')) {
      const close = this.matching(i)
      body = { start: this.tokens[i].start, end: this.tokens[close].end, expression: false }
      bodyTokens = { from: i, to: close + 1 }
      end = close + 1
    } else if (this.is(i, '=>')) {
      let k = i + 1
      while (k < this.tokens.length && !this.is(k, ';') && !this.is(k, '}')) {
        const text = this.tokens[k].text
        k =
          lookupOwn(CLOSERS, text) && this.tokens[k].kind === 'punct' ? this.matching(k) + 1 : k + 1
      }
      const last = Math.min(k, this.tokens.length - 1)
      body = { start: this.tokens[i].start, end: this.tokens[last].end, expression: true }
      bodyTokens = { from: i, to: Math.min(k + 1, this.tokens.length) }
      end = this.is(k, ';') ? k + 1 : k
    } else if (this.is(i, ';')) {
      end = i + 1
    }
    const nameToken = this.tokens[nameIndex]
    container.members.push({
      kind: 'method',
      name: nameToken.text,
      nameSpan: { start: nameToken.start, end: nameToken.end },
      span: this.spanOf(declStart, Math.max(declStart, Math.min(end, this.tokens.length) - 1)),
      signatureSpan: this.spanOf(typeStart - modifiers.length, closeParen),
      returnType: this.textOf(typeStart, typeEnd),
      returnTypeSpan: this.spanOf(typeStart, typeEnd - 1),
      modifiers,
      attributes,
      typeParameters,
      parameters,
      parameterListSpan: this.spanOf(openParen, closeParen),
      body,
      bodyTokens
    })
    return Math.max(end, closeParen + 1)
  }
}
