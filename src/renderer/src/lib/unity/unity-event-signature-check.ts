import { translate } from '@/i18n/i18n'
import { lookupOwn } from './csharp-lexer'
import { methodsOf } from './csharp-syntax-outline'
import type { CSharpMethod, CSharpSpan, CSharpTypeDeclaration } from './csharp-syntax-outline-types'
import { formatUnityEventSignature, UNITY_EVENT_FUNCTIONS } from './unity-event-functions'
import type {
  UnityBaseKind,
  UnityEventFunction,
  UnityMessageParameter
} from './unity-event-function-types'

export type UnitySignatureFinding = {
  kind: 'signature' | 'name'
  method: CSharpMethod
  message: UnityEventFunction
  text: string
  fix: { title: string; span: CSharpSpan; text: string }
}

const SYSTEM_ALIASES: Record<string, string> = {
  Single: 'float',
  Double: 'double',
  Int32: 'int',
  Int64: 'long',
  Boolean: 'bool',
  String: 'string',
  Byte: 'byte'
}

/** Comparable form of a written type: no whitespace, no namespace qualifiers, System aliases. */
export function normalizeCSharpTypeName(type: string): string {
  const compact = type.replace(/\s+/g, '').replace(/^global::/, '')
  const match = compact.match(/^([\w.]+)(.*)$/)
  if (!match) {
    return compact
  }
  const [, qualified, suffix] = match
  const simple = qualified.slice(qualified.lastIndexOf('.') + 1)
  if (qualified === 'System.Object') {
    return `object${suffix}`
  }
  const alias = lookupOwn(SYSTEM_ALIASES, simple)
  return `${alias && (qualified === simple || qualified === `System.${simple}`) ? alias : simple}${suffix}`
}

function parametersMatch(method: CSharpMethod, expected: UnityMessageParameter[]): boolean {
  return (
    method.parameters.length === expected.length &&
    method.parameters.every(
      (parameter, index) =>
        parameter.modifier === undefined &&
        normalizeCSharpTypeName(parameter.type) === normalizeCSharpTypeName(expected[index].type)
    )
  )
}

function acceptedParameterLists(message: UnityEventFunction): UnityMessageParameter[][] {
  const lists = [message.parameters, ...message.alternativeParameters]
  if (message.parametersOptional) {
    lists.push([])
  }
  return lists
}

function isCoroutineReturn(returnType: string): boolean {
  return normalizeCSharpTypeName(returnType) === 'IEnumerator'
}

function returnTypeMatches(method: CSharpMethod, message: UnityEventFunction): boolean {
  if (normalizeCSharpTypeName(method.returnType) === normalizeCSharpTypeName(message.returnType)) {
    return true
  }
  return message.coroutine && isCoroutineReturn(method.returnType)
}

/** Whether `method` is a valid declaration of `message` that Unity will invoke. */
export function matchesUnityEventSignature(
  method: CSharpMethod,
  message: UnityEventFunction
): boolean {
  return (
    method.name === message.name &&
    method.typeParameters.length === 0 &&
    method.modifiers.includes('static') === message.isStatic &&
    returnTypeMatches(method, message) &&
    acceptedParameterLists(message).some((list) => parametersMatch(method, list))
  )
}

function describeProblem(method: CSharpMethod, message: UnityEventFunction): string {
  const isStatic = method.modifiers.includes('static')
  if (isStatic !== message.isStatic) {
    return message.isStatic
      ? translate('auto.lib.unity.signature.mustBeStatic', 'must be static')
      : translate('auto.lib.unity.signature.mustNotBeStatic', 'must not be static')
  }
  if (method.typeParameters.length > 0) {
    return translate('auto.lib.unity.signature.mustNotBeGeneric', 'must not be generic')
  }
  if (!returnTypeMatches(method, message)) {
    return message.coroutine
      ? translate(
          'auto.lib.unity.signature.mustReturnOrCoroutine',
          'must return {{returnType}} or IEnumerator',
          { returnType: message.returnType }
        )
      : translate('auto.lib.unity.signature.mustReturn', 'must return {{returnType}}', {
          returnType: message.returnType
        })
  }
  return translate('auto.lib.unity.signature.incorrectParameters', 'has incorrect parameters')
}

function expectedParametersFor(
  method: CSharpMethod,
  message: UnityEventFunction
): UnityMessageParameter[] {
  const lists = [message.parameters, ...message.alternativeParameters]
  const closest =
    lists.find((list) => list.length === method.parameters.length) ?? message.parameters
  // Keep the user's parameter names when the arity already lines up.
  return closest.map((parameter, index) => ({
    type: parameter.type,
    name:
      method.parameters.length === closest.length && method.parameters[index].name
        ? method.parameters[index].name
        : parameter.name
  }))
}

/** Replacement text for the method header (modifiers through the parameter list). */
function correctedUnityEventHeader(method: CSharpMethod, message: UnityEventFunction): string {
  const modifiers = method.modifiers.filter((modifier) => modifier !== 'static')
  if (message.isStatic) {
    const accessIndex = modifiers.findIndex(
      (m) => m === 'public' || m === 'private' || m === 'protected' || m === 'internal'
    )
    modifiers.splice(accessIndex + 1, 0, 'static')
  }
  const keepCoroutine = message.coroutine && isCoroutineReturn(method.returnType)
  const returnType = keepCoroutine ? method.returnType : message.returnType
  const parameters = expectedParametersFor(method, message)
    .map((parameter) => `${parameter.type} ${parameter.name}`)
    .join(', ')
  return `${modifiers.map((m) => `${m} `).join('')}${returnType} ${message.name}(${parameters})`
}

/** Event-function declarations in a Unity-derived type that Unity will not invoke as written. */
export function checkUnityEventSignatures(
  type: CSharpTypeDeclaration,
  kind: UnityBaseKind
): UnitySignatureFinding[] {
  const messages = UNITY_EVENT_FUNCTIONS[kind]
  const methods = methodsOf(type)
  const findings: UnitySignatureFinding[] = []
  for (const message of messages) {
    const candidates = methods.filter((method) => method.name === message.name)
    if (candidates.length > 0) {
      // Other overloads are harmless once one declaration matches.
      if (candidates.some((method) => matchesUnityEventSignature(method, message))) {
        continue
      }
      for (const method of candidates) {
        findings.push({
          kind: 'signature',
          method,
          message,
          text: translate(
            'auto.lib.unity.signature.incorrect',
            "Incorrect signature for Unity event function '{{name}}': {{problem}}. Expected '{{expected}}'.",
            {
              name: message.name,
              problem: describeProblem(method, message),
              expected: formatUnityEventSignature(message)
            }
          ),
          fix: {
            title: translate(
              'auto.lib.unity.signature.changeFix',
              "Change signature to '{{expected}}'",
              {
                expected: formatUnityEventSignature(message)
              }
            ),
            span: method.signatureSpan,
            text: correctedUnityEventHeader(method, message)
          }
        })
      }
      continue
    }
    const lower = message.name.toLowerCase()
    for (const method of methods) {
      if (
        method.name !== message.name &&
        method.name.toLowerCase() === lower &&
        !method.modifiers.includes('override')
      ) {
        findings.push({
          kind: 'name',
          method,
          message,
          text: translate(
            'auto.lib.unity.signature.caseMismatch',
            "'{{actual}}' differs from Unity event function '{{name}}' only by case; Unity will not call it.",
            { actual: method.name, name: message.name }
          ),
          fix: {
            title: translate('auto.lib.unity.signature.renameFix', "Rename to '{{name}}'", {
              name: message.name
            }),
            span: method.nameSpan,
            text: message.name
          }
        })
      }
    }
  }
  return findings
}
