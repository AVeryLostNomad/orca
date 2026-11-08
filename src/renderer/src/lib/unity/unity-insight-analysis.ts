import { translate } from '@/i18n/i18n'
import type { UnityProjectInfo } from '../../../../shared/unity-types'
import { methodsOf } from './csharp-syntax-outline'
import type {
  CSharpOutline,
  CSharpSpan,
  CSharpTypeDeclaration
} from './csharp-syntax-outline-types'
import { UNITY_EVENT_FUNCTIONS } from './unity-event-functions'
import type { UnityBaseKind, UnityEventFunction } from './unity-event-function-types'
import {
  checkUnityEventSignatures,
  matchesUnityEventSignature
} from './unity-event-signature-check'
import {
  findExpensiveInvocations,
  findPerformanceCriticalMethods,
  findStringIdLookups,
  type UnityPerformanceCriticalMethod
} from './unity-performance-context'
import { findUnityStringSlots, type UnityStringSlot } from './unity-string-literal-context'
import { validateUnityStringSlot } from './unity-string-literal-validation'

export type UnityInsightOwner = 'unity:signature' | 'unity:perf' | 'unity:strings'

export type UnityInsightDiagnostic = {
  owner: UnityInsightOwner
  severity: 'warning' | 'info' | 'hint'
  span: CSharpSpan
  message: string
  code: string
  fix?: { title: string; span: CSharpSpan; text: string }
}

export type UnityInsightLens =
  | { kind: 'event'; span: CSharpSpan; message: UnityEventFunction; coroutine: boolean }
  | { kind: 'serialized'; span: CSharpSpan; name: string }
  | { kind: 'asset-usages'; span: CSharpSpan; typeName: string }
  | { kind: 'handler-usages'; span: CSharpSpan; methodName: string }

export type UnityInsightAnalysis = {
  diagnostics: UnityInsightDiagnostic[]
  lenses: UnityInsightLens[]
  performanceCritical: UnityPerformanceCriticalMethod[]
  stringSlots: UnityStringSlot[]
}

// Containers whose instances Unity serializes; AssetPostprocessor instances are transient.
const SERIALIZING_KINDS: Record<UnityBaseKind, boolean> = {
  MonoBehaviour: true,
  ScriptableObject: true,
  StateMachineBehaviour: true,
  Editor: true,
  EditorWindow: true,
  AssetPostprocessor: false
}

const NON_SERIALIZABLE_TYPE =
  /^(?:System\.)?(?:Collections\.Generic\.)?(?:Dictionary|HashSet|Queue|Stack|LinkedList|Action|Func|Task|IEnumerable|IList)\b|^(?:Action|Func)$/

function hasAttribute(
  attributes: { name: string; target?: string }[],
  name: string,
  target?: string
): boolean {
  return attributes.some((attribute) => attribute.name === name && attribute.target === target)
}

function serializedFieldLenses(type: CSharpTypeDeclaration): UnityInsightLens[] {
  const lenses: UnityInsightLens[] = []
  for (const member of type.members) {
    if (member.kind === 'field') {
      const { modifiers, attributes } = member
      if (
        modifiers.includes('static') ||
        modifiers.includes('const') ||
        modifiers.includes('readonly')
      ) {
        continue
      }
      if (hasAttribute(attributes, 'NonSerialized') || NON_SERIALIZABLE_TYPE.test(member.type)) {
        continue
      }
      const explicit =
        hasAttribute(attributes, 'SerializeField') || hasAttribute(attributes, 'SerializeReference')
      if (!explicit && !modifiers.includes('public')) {
        continue
      }
      for (const { name, span } of member.names) {
        lenses.push({ kind: 'serialized', span, name })
      }
    } else if (
      member.kind === 'property' &&
      member.auto &&
      (hasAttribute(member.attributes, 'SerializeField', 'field') ||
        hasAttribute(member.attributes, 'SerializeReference', 'field'))
    ) {
      lenses.push({ kind: 'serialized', span: member.nameSpan, name: member.name })
    }
  }
  return lenses
}

// UnityEvent handlers are public instance methods taking at most one argument.
function handlerCandidates(type: CSharpTypeDeclaration, kind: UnityBaseKind): UnityInsightLens[] {
  if (kind !== 'MonoBehaviour' && kind !== 'ScriptableObject') {
    return []
  }
  const messages = UNITY_EVENT_FUNCTIONS[kind]
  return methodsOf(type)
    .filter(
      (method) =>
        method.modifiers.includes('public') &&
        !method.modifiers.includes('static') &&
        method.typeParameters.length === 0 &&
        method.parameters.length <= 1 &&
        !messages.some((message) => message.name === method.name)
    )
    .map((method) => ({ kind: 'handler-usages', span: method.nameSpan, methodName: method.name }))
}

/** Unity code insight for one C# document, given each type's resolved Unity base kind. */
export function analyzeUnityDocument(args: {
  outline: CSharpOutline
  typeKinds: Map<CSharpTypeDeclaration, UnityBaseKind>
  project: UnityProjectInfo | null
  /** File name without extension; Unity binds a script asset to the class of the same name. */
  scriptName: string
}): UnityInsightAnalysis {
  const { outline, typeKinds, project, scriptName } = args
  const { tokens } = outline
  const diagnostics: UnityInsightDiagnostic[] = []
  const lenses: UnityInsightLens[] = []
  const performanceCritical: UnityPerformanceCriticalMethod[] = []

  for (const type of outline.types) {
    const kind = typeKinds.get(type)
    if (!kind) {
      if (
        hasAttribute(type.attributes, 'Serializable') &&
        (type.kind === 'class' || type.kind === 'struct')
      ) {
        lenses.push(...serializedFieldLenses(type))
      }
      continue
    }
    if (
      type.name === scriptName &&
      !type.containingType &&
      !type.modifiers.includes('abstract') &&
      (kind === 'MonoBehaviour' || kind === 'ScriptableObject')
    ) {
      lenses.push({ kind: 'asset-usages', span: type.nameSpan, typeName: type.name })
    }
    const messages = UNITY_EVENT_FUNCTIONS[kind]
    for (const method of methodsOf(type)) {
      const message = messages.find((candidate) => matchesUnityEventSignature(method, candidate))
      if (message) {
        lenses.push({
          kind: 'event',
          span: method.nameSpan,
          message,
          coroutine: message.coroutine && method.returnType.endsWith('IEnumerator')
        })
      }
    }
    if (SERIALIZING_KINDS[kind]) {
      lenses.push(...serializedFieldLenses(type))
    }
    lenses.push(...handlerCandidates(type, kind))

    for (const finding of checkUnityEventSignatures(type, kind)) {
      diagnostics.push({
        owner: 'unity:signature',
        severity: finding.kind === 'signature' ? 'warning' : 'info',
        span: finding.kind === 'signature' ? finding.method.signatureSpan : finding.method.nameSpan,
        message: finding.text,
        code: finding.kind === 'signature' ? 'UnityIncorrectEventSignature' : 'UnityEventNameCase',
        fix: finding.fix
      })
    }

    const critical = findPerformanceCriticalMethods(tokens, type, kind)
    performanceCritical.push(...critical)
    for (const invocation of findExpensiveInvocations(
      tokens,
      critical,
      project?.editorVersion ?? null
    )) {
      diagnostics.push({
        owner: 'unity:perf',
        severity: 'info',
        span: invocation.span,
        message:
          invocation.context.path.length > 1
            ? translate(
                'auto.lib.unity.perf.expensiveVia',
                "Expensive method invocation '{{api}}' in a frequently called context (reached from {{chain}}). {{reason}}",
                {
                  api: invocation.api,
                  chain: invocation.context.path.join(' → '),
                  reason: invocation.reason
                }
              )
            : translate(
                'auto.lib.unity.perf.expensive',
                "Expensive method invocation '{{api}}' in a frequently called context. {{reason}}",
                {
                  api: invocation.api,
                  reason: invocation.reason
                }
              ),
        code: 'UnityExpensiveInvocation'
      })
    }
    for (const lookup of findStringIdLookups(tokens, type)) {
      diagnostics.push({
        owner: 'unity:perf',
        severity: 'hint',
        span: lookup.span,
        message: translate(
          'auto.lib.unity.perf.stringLookup',
          "String-based lookup in '{{api}}' hashes the name on every call; cache it with {{helper}}.",
          {
            api: lookup.api,
            helper: lookup.helper
          }
        ),
        code: 'UnityStringPropertyLookup'
      })
    }
  }

  const stringSlots = findUnityStringSlots(tokens)
  if (project) {
    for (const slot of stringSlots) {
      const problem = validateUnityStringSlot(project, slot)
      if (problem) {
        diagnostics.push({
          owner: 'unity:strings',
          severity: problem.severity,
          span: slot.span,
          message: problem.text,
          code: `UnityUnknown${slot.kind[0].toUpperCase()}${slot.kind.slice(1)}`
        })
      }
    }
  }
  return { diagnostics, lenses, performanceCritical, stringSlots }
}
