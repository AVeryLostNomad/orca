import { translate } from '@/i18n/i18n'
import { lookupOwn, type CSharpToken } from './csharp-lexer'
import {
  findCSharpInvocations,
  findCSharpMemberAccesses,
  receiverSimpleName,
  type CSharpInvocation
} from './csharp-invocations'
import { methodsOf } from './csharp-syntax-outline'
import type { CSharpMethod, CSharpSpan, CSharpTypeDeclaration } from './csharp-syntax-outline-types'
import { UNITY_EVENT_FUNCTIONS } from './unity-event-functions'
import type { UnityBaseKind } from './unity-event-function-types'
import { matchesUnityEventSignature, normalizeCSharpTypeName } from './unity-event-signature-check'
import {
  isCameraMainExpensive,
  UNITY_EXPENSIVE_METHODS,
  UNITY_PROPERTY_ID_HELPERS,
  UNITY_PROPERTY_ID_RECEIVER_TYPES,
  UNITY_STRING_ID_METHODS
} from './unity-expensive-apis'

export type UnityPerformanceCriticalMethod = {
  method: CSharpMethod
  /** The frequently-called event function this method is (transitively) reached from. */
  root: string
  /** Call chain from the root, e.g. `['Update', 'Move']`; length 1 for the root itself. */
  path: string[]
}

export type UnityExpensiveInvocation = {
  span: CSharpSpan
  api: string
  reason: string
  context: UnityPerformanceCriticalMethod
}

export type UnityStringIdLookup = {
  /** Span of the string literal argument. */
  span: CSharpSpan
  api: string
  helper: string
}

function sameTypeCallees(
  tokens: CSharpToken[],
  method: CSharpMethod,
  byName: Map<string, CSharpMethod[]>
): CSharpMethod[] {
  if (!method.bodyTokens) {
    return []
  }
  const callees: CSharpMethod[] = []
  for (const invocation of findCSharpInvocations(
    tokens,
    method.bodyTokens.from,
    method.bodyTokens.to
  )) {
    if (invocation.receiver !== null && invocation.receiver !== 'this') {
      continue
    }
    for (const target of byName.get(invocation.name) ?? []) {
      // Coroutines run spread over frames, not inside the caller's frame.
      if (normalizeCSharpTypeName(target.returnType) !== 'IEnumerator') {
        callees.push(target)
      }
    }
  }
  return callees
}

/** Frequently-called event functions plus every same-type method they transitively call. */
export function findPerformanceCriticalMethods(
  tokens: CSharpToken[],
  type: CSharpTypeDeclaration,
  kind: UnityBaseKind
): UnityPerformanceCriticalMethod[] {
  const methods = methodsOf(type)
  const byName = new Map<string, CSharpMethod[]>()
  for (const method of methods) {
    byName.set(method.name, [...(byName.get(method.name) ?? []), method])
  }
  const critical = new Map<CSharpMethod, UnityPerformanceCriticalMethod>()
  const queue: UnityPerformanceCriticalMethod[] = []
  for (const message of UNITY_EVENT_FUNCTIONS[kind]) {
    if (!message.performanceCritical) {
      continue
    }
    for (const method of byName.get(message.name) ?? []) {
      if (matchesUnityEventSignature(method, message) && !critical.has(method)) {
        const entry = { method, root: message.name, path: [message.name] }
        critical.set(method, entry)
        queue.push(entry)
      }
    }
  }
  // Breadth-first so each method records its shortest chain from a root.
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) {
      break
    }
    for (const callee of sameTypeCallees(tokens, current.method, byName)) {
      if (!critical.has(callee)) {
        const entry = { method: callee, root: current.root, path: [...current.path, callee.name] }
        critical.set(callee, entry)
        queue.push(entry)
      }
    }
  }
  return [...critical.values()]
}

function isExpensiveCall(invocation: CSharpInvocation): boolean {
  const api = lookupOwn(UNITY_EXPENSIVE_METHODS, invocation.name)
  if (!api) {
    return false
  }
  if (
    invocation.receiver === null ||
    invocation.receiver === 'this' ||
    invocation.receiver === 'base'
  ) {
    return api.unqualified
  }
  const receiver = receiverSimpleName(invocation.receiver)
  return api.receivers === 'any' || (receiver !== null && api.receivers.includes(receiver))
}

export function findExpensiveInvocations(
  tokens: CSharpToken[],
  critical: UnityPerformanceCriticalMethod[],
  editorVersion: string | null
): UnityExpensiveInvocation[] {
  const found: UnityExpensiveInvocation[] = []
  const flagCameraMain = isCameraMainExpensive(editorVersion)
  for (const context of critical) {
    const body = context.method.bodyTokens
    if (!body) {
      continue
    }
    for (const invocation of findCSharpInvocations(tokens, body.from, body.to)) {
      if (!isExpensiveCall(invocation)) {
        continue
      }
      const name = tokens[invocation.nameIndex]
      const receiver = receiverSimpleName(invocation.receiver)
      found.push({
        span: { start: name.start, end: name.end },
        api:
          receiver && receiver !== '(expr)' && receiver !== 'this'
            ? `${receiver}.${invocation.name}`
            : invocation.name,
        reason: UNITY_EXPENSIVE_METHODS[invocation.name].reason(),
        context
      })
    }
    if (flagCameraMain) {
      for (const access of findCSharpMemberAccesses(tokens, body.from, body.to)) {
        if (access.name === 'main' && receiverSimpleName(access.receiver) === 'Camera') {
          const name = tokens[access.nameIndex]
          found.push({
            span: { start: name.start, end: name.end },
            api: 'Camera.main',
            reason: translate(
              'auto.lib.unity.perf.reason.cameraMain',
              'Searches for the MainCamera tag on every access in this Unity version; cache it.'
            ),
            context
          })
        }
      }
    }
  }
  return found
}

/** Declared types of fields, parameters and simple locals visible in a method, by name. */
function variableTypes(
  tokens: CSharpToken[],
  type: CSharpTypeDeclaration,
  method: CSharpMethod
): Map<string, string> {
  const types = new Map<string, string>()
  for (const member of type.members) {
    if (member.kind === 'field') {
      for (const { name } of member.names) {
        types.set(name, member.type)
      }
    } else if (member.kind === 'property') {
      types.set(member.name, member.type)
    }
  }
  for (const parameter of method.parameters) {
    types.set(parameter.name, parameter.type)
  }
  const body = method.bodyTokens
  if (!body) {
    return types
  }
  for (let i = body.from; i < body.to - 2; i++) {
    const [typeToken, nameToken, next] = [tokens[i], tokens[i + 1], tokens[i + 2]]
    if (
      typeToken.kind !== 'identifier' ||
      nameToken.kind !== 'identifier' ||
      (next.text !== '=' && next.text !== ';')
    ) {
      continue
    }
    if (typeToken.text !== 'var') {
      types.set(nameToken.text, typeToken.text)
      continue
    }
    // `var a = GetComponent<Animator>()` / `var m = new Material(...)`.
    const after = tokens.slice(i + 3, Math.min(i + 9, body.to))
    const generic = after.findIndex((t) => t.text === '<')
    if (after[0]?.text === 'new' && after[1]?.kind === 'identifier') {
      types.set(nameToken.text, after[1].text)
    } else if (
      generic > 0 &&
      after[generic - 1].text.startsWith('GetComponent') &&
      after[generic + 1]
    ) {
      types.set(nameToken.text, after[generic + 1].text)
    }
  }
  return types
}

function receiverIdKind(
  receiver: string | null,
  variables: Map<string, string>
): 'animator' | 'shader' | null {
  if (receiver === null) {
    return null
  }
  const simple = receiverSimpleName(receiver) ?? receiver
  if (simple === 'material' || simple === 'sharedMaterial') {
    return 'shader'
  }
  if (simple === 'Shader') {
    return 'shader'
  }
  const declared = variables.get(simple)
  return declared
    ? (lookupOwn(UNITY_PROPERTY_ID_RECEIVER_TYPES, normalizeCSharpTypeName(declared)) ?? null)
    : null
}

/** `animator.SetFloat("Speed", v)`-style calls that should pass a cached property id. */
export function findStringIdLookups(
  tokens: CSharpToken[],
  type: CSharpTypeDeclaration
): UnityStringIdLookup[] {
  const found: UnityStringIdLookup[] = []
  for (const method of methodsOf(type)) {
    const body = method.bodyTokens
    if (!body) {
      continue
    }
    let variables: Map<string, string> | null = null
    for (const invocation of findCSharpInvocations(tokens, body.from, body.to)) {
      const kinds = lookupOwn(UNITY_STRING_ID_METHODS, invocation.name)
      const first = invocation.args[0]
      if (!kinds || !first || first.to - first.from !== 1) {
        continue
      }
      const literal = tokens[first.from]
      if (literal.kind !== 'string' || literal.interpolated) {
        continue
      }
      variables ??= variableTypes(tokens, type, method)
      const kind = receiverIdKind(invocation.receiver, variables)
      if (!kind || !kinds.includes(kind)) {
        continue
      }
      found.push({
        span: { start: literal.start, end: literal.end },
        api: invocation.name,
        helper: UNITY_PROPERTY_ID_HELPERS[kind]
      })
    }
  }
  return found
}
