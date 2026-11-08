import type { CSharpToken } from './csharp-lexer'
import { lookupOwn } from './csharp-lexer'
import {
  findCSharpInvocations,
  receiverSimpleName,
  type CSharpInvocation
} from './csharp-invocations'
import type { CSharpSpan } from './csharp-syntax-outline-types'

export type UnityStringSlotKind = 'tag' | 'layer' | 'scene' | 'input' | 'sortingLayer'

export type UnityStringSlot = {
  kind: UnityStringSlotKind
  /** Index into the significant token list of the string (or number, for scene indices). */
  tokenIndex: number
  /** Literal value; null for interpolated strings that cannot be checked. */
  value: string | null
  /** Build index for `SceneManager.LoadScene(3)`. */
  sceneIndex?: number
  /** Span of the literal including quotes. */
  span: CSharpSpan
  /** Span of the literal's content between the quotes. */
  contentSpan: CSharpSpan
  /** Description of the API, e.g. `CompareTag`. */
  api: string
}

type SlotRule = {
  kind: UnityStringSlotKind
  /** Required receiver simple names; empty = any receiver or unqualified. */
  receivers: string[]
  /** Every argument is a slot (params string[]). */
  allArguments?: true
  allowsIndex?: true
}

const INVOCATION_RULES: Record<string, SlotRule> = {
  CompareTag: { kind: 'tag', receivers: [] },
  FindWithTag: { kind: 'tag', receivers: ['GameObject'] },
  FindGameObjectWithTag: { kind: 'tag', receivers: ['GameObject'] },
  FindGameObjectsWithTag: { kind: 'tag', receivers: ['GameObject'] },
  NameToLayer: { kind: 'layer', receivers: ['LayerMask'] },
  GetMask: { kind: 'layer', receivers: ['LayerMask'], allArguments: true },
  LoadScene: { kind: 'scene', receivers: ['SceneManager'], allowsIndex: true },
  LoadSceneAsync: { kind: 'scene', receivers: ['SceneManager'], allowsIndex: true },
  UnloadSceneAsync: { kind: 'scene', receivers: ['SceneManager'], allowsIndex: true },
  GetSceneByName: { kind: 'scene', receivers: ['SceneManager'] },
  GetSceneByBuildIndex: { kind: 'scene', receivers: ['SceneManager'], allowsIndex: true },
  GetAxis: { kind: 'input', receivers: ['Input'] },
  GetAxisRaw: { kind: 'input', receivers: ['Input'] },
  GetButton: { kind: 'input', receivers: ['Input'] },
  GetButtonDown: { kind: 'input', receivers: ['Input'] },
  GetButtonUp: { kind: 'input', receivers: ['Input'] },
  NameToID: { kind: 'sortingLayer', receivers: ['SortingLayer'] },
  GetLayerValueFromName: { kind: 'sortingLayer', receivers: ['SortingLayer'] }
}

/** Members compared or assigned with a string literal (`tag == "Player"`, `sortingLayerName = "UI"`). */
const MEMBER_RULES: Record<string, UnityStringSlotKind> = {
  tag: 'tag',
  sortingLayerName: 'sortingLayer'
}

function stringSlot(
  tokens: CSharpToken[],
  index: number,
  kind: UnityStringSlotKind,
  api: string
): UnityStringSlot | null {
  const token = tokens[index]
  if (token?.kind !== 'string') {
    return null
  }
  const open = token.text.indexOf('"')
  const run = token.text.slice(open).match(/^"+/)?.[0].length ?? 1
  // Three or more quotes open a raw string; `""` is an empty regular literal.
  const quoteRun = run >= 3 && token.text.length > run ? run : 1
  const closeLength = token.terminated === false ? 0 : quoteRun
  return {
    kind,
    tokenIndex: index,
    value: token.interpolated ? null : (token.value ?? null),
    span: { start: token.start, end: token.end },
    contentSpan: { start: token.start + open + quoteRun, end: token.end - closeLength },
    api
  }
}

function invocationSlots(tokens: CSharpToken[], invocation: CSharpInvocation): UnityStringSlot[] {
  const rule = lookupOwn(INVOCATION_RULES, invocation.name)
  if (!rule) {
    return []
  }
  const receiver = receiverSimpleName(invocation.receiver)
  if (rule.receivers.length > 0 && (receiver === null || !rule.receivers.includes(receiver))) {
    return []
  }
  const api = receiver ? `${receiver}.${invocation.name}` : invocation.name
  const args = rule.allArguments ? invocation.args : invocation.args.slice(0, 1)
  const slots: UnityStringSlot[] = []
  for (const arg of args) {
    // Only bare literals: `CompareTag(prefix + "x")` cannot be checked.
    if (arg.to - arg.from !== 1) {
      continue
    }
    const slot = stringSlot(tokens, arg.from, rule.kind, api)
    if (slot) {
      slots.push(slot)
      continue
    }
    const token = tokens[arg.from]
    if (rule.allowsIndex && token.kind === 'number' && /^\d+$/.test(token.text)) {
      slots.push({
        kind: rule.kind,
        tokenIndex: arg.from,
        value: null,
        sceneIndex: Number(token.text),
        span: { start: token.start, end: token.end },
        contentSpan: { start: token.start, end: token.end },
        api
      })
    }
  }
  return slots
}

/** `member == "x"`, `"x" == member`, `member != "x"`, `member = "x"` for tag/sortingLayerName. */
function memberSlots(tokens: CSharpToken[]): UnityStringSlot[] {
  const slots: UnityStringSlot[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.kind !== 'identifier') {
      continue
    }
    const kind = lookupOwn(MEMBER_RULES, token.text)
    if (!kind) {
      continue
    }
    // Start of the receiver chain (`other.gameObject.tag` → `other`).
    let chainStart = i
    while (
      tokens[chainStart - 1]?.text === '.' &&
      /^(?:identifier|keyword)$/.test(tokens[chainStart - 2]?.kind ?? '')
    ) {
      chainStart -= 2
    }
    const before = tokens[chainStart - 1]
    // A declaration (`string tag = "x"`) is a local, not the Unity member.
    if (
      chainStart === i &&
      before &&
      (before.kind === 'identifier' || before.kind === 'keyword') &&
      before.text !== 'return'
    ) {
      continue
    }
    const op = tokens[i + 1]?.text
    if (op === '==' || op === '!=' || op === '=') {
      const slot = stringSlot(tokens, i + 2, kind, token.text)
      // Require the literal to end the operand (`tag == "a" + b` is not checkable).
      const after = tokens[i + 3]?.text
      if (slot && after !== '+' && after !== '.') {
        slots.push(slot)
      }
    }
    if (
      (before?.text === '==' || before?.text === '!=') &&
      tokens[chainStart - 2]?.kind === 'string'
    ) {
      const slot = stringSlot(tokens, chainStart - 2, kind, token.text)
      if (slot && tokens[chainStart - 3]?.text !== '+') {
        slots.push(slot)
      }
    }
  }
  return slots
}

export function findUnityStringSlots(tokens: CSharpToken[]): UnityStringSlot[] {
  const slots = findCSharpInvocations(tokens, 0, tokens.length).flatMap((invocation) =>
    invocationSlots(tokens, invocation)
  )
  slots.push(...memberSlots(tokens))
  return slots.sort((a, b) => a.span.start - b.span.start)
}

/** Slot whose string content contains the caret. */
export function unityStringSlotAtOffset(
  slots: UnityStringSlot[],
  offset: number
): UnityStringSlot | null {
  return (
    slots.find(
      (slot) =>
        slot.sceneIndex === undefined &&
        slot.contentSpan.start <= offset &&
        offset <= slot.contentSpan.end
    ) ?? null
  )
}
