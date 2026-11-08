/** Unity base classes whose subclasses receive reflection-invoked event functions ("messages"). */
export type UnityBaseKind =
  | 'MonoBehaviour'
  | 'ScriptableObject'
  | 'Editor'
  | 'EditorWindow'
  | 'AssetPostprocessor'
  | 'StateMachineBehaviour'

export type UnityMessageParameter = { type: string; name: string }

export type UnityEventFunction = {
  name: string
  /** Declaring Unity type in the scripting reference. */
  owner: UnityBaseKind
  returnType: string
  parameters: UnityMessageParameter[]
  /** Other parameter lists Unity also accepts (e.g. newer overloads). */
  alternativeParameters: UnityMessageParameter[][]
  /** Unity also invokes the parameterless form (collision callbacks). */
  parametersOptional: boolean
  isStatic: boolean
  /** May be declared as `IEnumerator` and runs as a coroutine. */
  coroutine: boolean
  /** Called every frame (or more often); expensive calls inside are flagged. */
  performanceCritical: boolean
  description: string
  /** `unity docs` topic, e.g. `MonoBehaviour.Update`; null when undocumented. */
  docsTopic: string | null
}

export type EventFunctionOptions = {
  returns?: string
  alternatives?: string[]
  optionalParameters?: true
  isStatic?: true
  coroutine?: true
  perf?: true
  undocumented?: true
}

function parseParameterList(list: string): UnityMessageParameter[] {
  if (!list.trim()) {
    return []
  }
  return list.split(',').map((part) => {
    const trimmed = part.trim()
    const space = trimmed.lastIndexOf(' ')
    return { type: trimmed.slice(0, space), name: trimmed.slice(space + 1) }
  })
}

export function messagesOf(
  owner: UnityBaseKind,
  entries: [name: string, parameters: string, description: string, options?: EventFunctionOptions][]
): UnityEventFunction[] {
  return entries.map(([name, parameters, description, options = {}]) => ({
    name,
    owner,
    returnType: options.returns ?? 'void',
    parameters: parseParameterList(parameters),
    alternativeParameters: (options.alternatives ?? []).map(parseParameterList),
    parametersOptional: options.optionalParameters === true,
    isStatic: options.isStatic === true,
    coroutine: options.coroutine === true,
    performanceCritical: options.perf === true,
    description,
    docsTopic: options.undocumented ? null : `${owner}.${name}`
  }))
}
