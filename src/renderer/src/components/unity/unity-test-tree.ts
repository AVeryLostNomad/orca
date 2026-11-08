import type { UnityTestCaseResult } from '../../../../shared/unity-types'

export type UnityTestStatus = UnityTestCaseResult['result'] | 'not-run'

export type UnityTestTreeNode = {
  /** Kind-prefixed path, unique across the tree. */
  id: string
  label: string
  kind: 'namespace' | 'class' | 'test'
  /** Full names of every test at or below this node. */
  testNames: string[]
  children: UnityTestTreeNode[]
}

/** Splits on '.' only outside parentheses and quotes, so `M(1,"a.b")` stays one segment. */
export function splitUnityTestFullName(fullName: string): string[] {
  const segments: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0
  for (let index = 0; index < fullName.length; index += 1) {
    const char = fullName[index]
    if (quote) {
      if (char === '\\') {
        index += 1
      } else if (char === quote) {
        quote = null
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
    } else if (char === '(' || char === '<' || char === '[') {
      depth += 1
    } else if ((char === ')' || char === '>' || char === ']') && depth > 0) {
      depth -= 1
    } else if (char === '.' && depth === 0) {
      segments.push(fullName.slice(start, index))
      start = index + 1
    }
  }
  segments.push(fullName.slice(start))
  return segments.filter((segment) => segment.length > 0)
}

type ParentNode = { children: UnityTestTreeNode[]; childById: Map<string, MutableNode> }
type MutableNode = UnityTestTreeNode & ParentNode

function childNode(
  parent: ParentNode,
  id: string,
  label: string,
  kind: UnityTestTreeNode['kind']
): MutableNode {
  let node = parent.childById.get(id)
  if (!node) {
    node = { id, label, kind, testNames: [], children: [], childById: new Map() }
    parent.childById.set(id, node)
    parent.children.push(node)
  }
  return node
}

function freeze(nodes: readonly UnityTestTreeNode[]): UnityTestTreeNode[] {
  return nodes.map(({ id, label, kind, testNames, children }) => ({
    id,
    label,
    kind,
    testNames,
    children: freeze(children)
  }))
}

/** Namespace (one joined node) → class → test, in first-seen order. */
export function buildUnityTestTree(fullNames: readonly string[]): UnityTestTreeNode[] {
  const root: ParentNode = { children: [], childById: new Map() }
  for (const fullName of new Set(fullNames)) {
    const segments = splitUnityTestFullName(fullName)
    const testLabel = segments.at(-1) ?? fullName
    const className = segments.length > 1 ? (segments.at(-2) ?? null) : null
    const namespaceName = segments.length > 2 ? segments.slice(0, -2).join('.') : null
    let parent = root
    const chain: MutableNode[] = []
    if (namespaceName) {
      const node = childNode(parent, `n:${namespaceName}`, namespaceName, 'namespace')
      chain.push(node)
      parent = node
    }
    if (className) {
      const classId = `c:${namespaceName ?? ''}.${className}`
      const node = childNode(parent, classId, className, 'class')
      chain.push(node)
      parent = node
    }
    chain.push(childNode(parent, `t:${fullName}`, testLabel, 'test'))
    for (const node of chain) {
      node.testNames.push(fullName)
    }
  }
  return freeze(root.children)
}

export type UnityTestTreeRow = { node: UnityTestTreeNode; depth: number }

export function flattenUnityTestTree(
  nodes: readonly UnityTestTreeNode[],
  collapsedIds: ReadonlySet<string>,
  depth = 0,
  rows: UnityTestTreeRow[] = []
): UnityTestTreeRow[] {
  for (const node of nodes) {
    rows.push({ node, depth })
    if (!collapsedIds.has(node.id)) {
      flattenUnityTestTree(node.children, collapsedIds, depth + 1, rows)
    }
  }
  return rows
}

/** Precedence over run children: failed, inconclusive, passed, skipped; nothing run → not-run. */
export function aggregateUnityTestStatus(
  testNames: readonly string[],
  resultsByName: ReadonlyMap<string, UnityTestCaseResult>
): UnityTestStatus {
  const seen = new Set<UnityTestStatus>()
  for (const name of testNames) {
    seen.add(resultsByName.get(name)?.result ?? 'not-run')
  }
  const precedence: UnityTestStatus[] = ['failed', 'inconclusive', 'passed', 'skipped']
  return precedence.find((status) => seen.has(status)) ?? 'not-run'
}
