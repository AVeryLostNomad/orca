import { translate } from '@/i18n/i18n'
import { lookupOwn, tokenIndexAtCaret, type CSharpToken } from './csharp-lexer'
import { methodsOf, typeAtOffset } from './csharp-syntax-outline'
import type { CSharpOutline, CSharpTypeDeclaration } from './csharp-syntax-outline-types'
import { formatUnityEventSignature, UNITY_EVENT_FUNCTIONS } from './unity-event-functions'
import type { UnityBaseKind, UnityEventFunction } from './unity-event-function-types'

const ACCESS_MODIFIERS: Record<string, true> = {
  public: true,
  private: true,
  protected: true,
  internal: true
}

export type UnityEventCompletionContext = {
  type: CSharpTypeDeclaration
  kind: UnityBaseKind
  /** Offset where the replaced text starts: the first typed modifier/return type, or the name. */
  replaceStart: number
  /** Offset after the identifier under the caret. */
  replaceEnd: number
  /** Source text typed before the name, e.g. `public void `. */
  typedPrefix: string
  accessModifiers: string[]
  returnType: 'void' | 'IEnumerator' | null
  /** False when modifiers sit on an earlier line and stay; only the name is inserted then. */
  replacesPrefix: boolean
}

/** Caret context for event-function completion: at member-declaration level of a Unity-derived
 *  type, after only access modifiers and an optional `void`/`IEnumerator`. */
export function unityEventCompletionContext(
  outline: CSharpOutline,
  offset: number,
  typeKinds: Map<CSharpTypeDeclaration, UnityBaseKind>
): UnityEventCompletionContext | null {
  const { allTokens, tokens, text } = outline
  const containing = tokenIndexAtCaret(allTokens, offset)
  if (
    containing !== -1 &&
    allTokens[containing].kind !== 'identifier' &&
    allTokens[containing].kind !== 'keyword'
  ) {
    return null
  }
  const type = typeAtOffset(outline, offset)
  const kind = type ? typeKinds.get(type) : undefined
  if (!type?.body || !kind) {
    return null
  }
  // Significant tokens before the caret, inside the type body.
  let last = -1
  let bodyOpen = -1
  for (let i = 0; i < tokens.length && tokens[i].start < offset; i++) {
    if (tokens[i].start === type.body.start) {
      bodyOpen = i
    }
    last = i
  }
  if (bodyOpen === -1) {
    return null
  }
  // The caret must not be nested in a member body, parameter list or initializer.
  let depth = 0
  for (let i = bodyOpen + 1; i <= last; i++) {
    const t = tokens[i].text
    if (tokens[i].kind !== 'punct') {
      continue
    }
    if (t === '{' || t === '(' || t === '[') {
      depth++
    } else if (t === '}' || t === ')' || t === ']') {
      depth--
    }
  }
  if (depth !== 0) {
    return null
  }
  let wordIndex = -1
  if (
    last > bodyOpen &&
    tokens[last].end >= offset &&
    /^(?:identifier|keyword)$/.test(tokens[last].kind)
  ) {
    wordIndex = last
  }
  const word = wordIndex === -1 ? null : tokens[wordIndex]
  const prefixTokens: CSharpToken[] = []
  for (let i = wordIndex === -1 ? last : wordIndex - 1; i > bodyOpen; i--) {
    const t = tokens[i].text
    if (t === ']') {
      // Directly after an attribute: the member is a field or a non-message method.
      return null
    }
    if (t === ';' || t === '}' || t === '{') {
      break
    }
    prefixTokens.unshift(tokens[i])
  }
  const accessModifiers: string[] = []
  let returnType: UnityEventCompletionContext['returnType'] = null
  for (const token of prefixTokens) {
    if (lookupOwn(ACCESS_MODIFIERS, token.text) && returnType === null) {
      accessModifiers.push(token.text)
    } else if ((token.text === 'void' || token.text === 'IEnumerator') && returnType === null) {
      returnType = token.text
    } else {
      return null
    }
  }
  if (
    word &&
    (lookupOwn(ACCESS_MODIFIERS, word.text) || word.text === 'void' || word.text === 'IEnumerator')
  ) {
    // Still typing the modifier or return type itself.
    return null
  }
  if (word && word.kind === 'keyword') {
    return null
  }
  const nameStart = word ? word.start : offset
  const firstPrefix = prefixTokens[0]
  // Completion ranges are single-line; fall back to replacing just the name across lines.
  const prefixOnLine =
    firstPrefix !== undefined && !text.slice(firstPrefix.start, nameStart).includes('\n')
  const replaceStart = prefixOnLine ? firstPrefix.start : nameStart
  return {
    type,
    kind,
    replaceStart,
    replaceEnd: word ? Math.max(word.end, offset) : offset,
    typedPrefix: text.slice(replaceStart, nameStart),
    accessModifiers,
    returnType,
    replacesPrefix: prefixOnLine || firstPrefix === undefined
  }
}

export type UnityEventCompletionItem = {
  message: UnityEventFunction
  coroutine: boolean
  label: string
  /** Snippet text replacing [replaceStart, replaceEnd). */
  insertText: string
  filterText: string
}

/** Not-yet-implemented event functions (and coroutine variants) for the context. */
export function unityEventCompletionItems(
  context: UnityEventCompletionContext
): UnityEventCompletionItem[] {
  const implemented = new Set(methodsOf(context.type).map((method) => method.name))
  const items: UnityEventCompletionItem[] = []
  const access = context.accessModifiers.length > 0 ? context.accessModifiers.join(' ') : 'private'
  for (const message of UNITY_EVENT_FUNCTIONS[context.kind]) {
    if (implemented.has(message.name)) {
      continue
    }
    const variants = [false, true].filter((coroutine) =>
      coroutine
        ? message.coroutine && context.returnType !== 'void'
        : context.returnType !== 'IEnumerator'
    )
    for (const coroutine of variants) {
      const parameters = message.parameters.map((p) => `${p.type} ${p.name}`).join(', ')
      const returnType = coroutine ? 'IEnumerator' : message.returnType
      const header = context.replacesPrefix
        ? `${access} ${message.isStatic ? 'static ' : ''}${returnType} ${message.name}(${parameters})`
        : `${context.returnType ? '' : `${returnType} `}${message.name}(${parameters})`
      const body = coroutine
        ? '\t$0\n\tyield return null;'
        : returnType === 'void'
          ? '\t$0'
          : '\t$0\n\treturn default;'
      items.push({
        message,
        coroutine,
        label: message.name,
        insertText: `${header}\n{\n${body}\n}`,
        filterText: `${context.typedPrefix}${message.name}`
      })
    }
  }
  return items
}

export function unityEventCompletionDocumentation(
  item: UnityEventCompletionItem,
  docsLink: string | null
): string {
  const lines = [
    '```csharp',
    formatUnityEventSignature(item.message, { coroutine: item.coroutine }),
    '```',
    item.message.description
  ]
  if (item.message.performanceCritical) {
    lines.push(
      '',
      `_${translate('auto.lib.unity.completion.frequentlyCalled', 'Frequently called: keep this method cheap.')}_`
    )
  }
  if (docsLink) {
    lines.push('', docsLink)
  }
  return lines.join('\n')
}
