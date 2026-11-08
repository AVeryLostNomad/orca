import { translate } from '@/i18n/i18n'
export type UnityExpensiveApi = {
  /** Receiver simple names that qualify the call (`GameObject.Find`), or 'any'. */
  receivers: string[] | 'any'
  /** Also matches unqualified calls inherited from Component/Object. */
  unqualified: boolean
  /** Translated lazily: the UI locale can load after module evaluation. */
  reason: () => string
}

const COMPONENT_LOOKUP = (): string =>
  translate(
    'auto.lib.unity.perf.reason.componentLookup',
    'Searches components on every call; cache the result in Awake/Start.'
  )
const SCENE_SEARCH = (): string =>
  translate(
    'auto.lib.unity.perf.reason.sceneSearch',
    'Searches the whole scene on every call; cache the result.'
  )
const MESSAGE_DISPATCH = (): string =>
  translate(
    'auto.lib.unity.perf.reason.messageDispatch',
    'Uses reflection-based message dispatch; call the method directly.'
  )

/** Calls Rider flags inside performance-critical contexts, keyed by method name. */
export const UNITY_EXPENSIVE_METHODS: Record<string, UnityExpensiveApi> = {
  GetComponent: { receivers: 'any', unqualified: true, reason: COMPONENT_LOOKUP },
  GetComponents: { receivers: 'any', unqualified: true, reason: COMPONENT_LOOKUP },
  GetComponentInChildren: { receivers: 'any', unqualified: true, reason: COMPONENT_LOOKUP },
  GetComponentsInChildren: { receivers: 'any', unqualified: true, reason: COMPONENT_LOOKUP },
  GetComponentInParent: { receivers: 'any', unqualified: true, reason: COMPONENT_LOOKUP },
  GetComponentsInParent: { receivers: 'any', unqualified: true, reason: COMPONENT_LOOKUP },
  AddComponent: {
    receivers: 'any',
    unqualified: true,
    reason: () =>
      translate(
        'auto.lib.unity.perf.reason.addComponent',
        'Adds a component and runs its initialization.'
      )
  },
  FindObjectOfType: { receivers: 'any', unqualified: true, reason: SCENE_SEARCH },
  FindObjectsOfType: { receivers: 'any', unqualified: true, reason: SCENE_SEARCH },
  FindFirstObjectByType: { receivers: 'any', unqualified: true, reason: SCENE_SEARCH },
  FindAnyObjectByType: { receivers: 'any', unqualified: true, reason: SCENE_SEARCH },
  FindObjectsByType: { receivers: 'any', unqualified: true, reason: SCENE_SEARCH },
  FindObjectsOfTypeAll: { receivers: ['Resources'], unqualified: false, reason: SCENE_SEARCH },
  Find: { receivers: ['GameObject'], unqualified: false, reason: SCENE_SEARCH },
  FindWithTag: { receivers: ['GameObject'], unqualified: false, reason: SCENE_SEARCH },
  FindGameObjectWithTag: { receivers: ['GameObject'], unqualified: false, reason: SCENE_SEARCH },
  FindGameObjectsWithTag: { receivers: ['GameObject'], unqualified: false, reason: SCENE_SEARCH },
  SendMessage: { receivers: 'any', unqualified: true, reason: MESSAGE_DISPATCH },
  SendMessageUpwards: { receivers: 'any', unqualified: true, reason: MESSAGE_DISPATCH },
  BroadcastMessage: { receivers: 'any', unqualified: true, reason: MESSAGE_DISPATCH },
  Load: {
    receivers: ['Resources'],
    unqualified: false,
    reason: () =>
      translate(
        'auto.lib.unity.perf.reason.resourcesLoad',
        'Loads an asset synchronously from disk.'
      )
  },
  LoadAll: {
    receivers: ['Resources'],
    unqualified: false,
    reason: () =>
      translate(
        'auto.lib.unity.perf.reason.resourcesLoadAll',
        'Loads assets synchronously from disk.'
      )
  },
  Instantiate: {
    receivers: ['Object', 'GameObject', 'MonoBehaviour', 'Component', 'ScriptableObject'],
    unqualified: true,
    reason: () =>
      translate(
        'auto.lib.unity.perf.reason.instantiate',
        'Clones a whole object hierarchy and allocates; consider pooling.'
      )
  }
}

/** Unity versions before 2020.2 looked Camera.main up with FindGameObjectsWithTag. */
export function isCameraMainExpensive(editorVersion: string | null): boolean {
  const match = editorVersion?.match(/^(\d+)\.(\d+)/)
  if (!match) {
    return false
  }
  const major = Number(match[1])
  const minor = Number(match[2])
  return major < 2020 || (major === 2020 && minor < 2)
}

export type UnityPropertyIdKind = 'animator' | 'shader'

/** Methods that take a parameter/property name string and also accept a cached int id. */
export const UNITY_STRING_ID_METHODS: Record<string, UnityPropertyIdKind[]> = {
  SetFloat: ['animator', 'shader'],
  GetFloat: ['animator', 'shader'],
  SetInteger: ['animator', 'shader'],
  GetInteger: ['animator', 'shader'],
  SetBool: ['animator'],
  GetBool: ['animator'],
  SetTrigger: ['animator'],
  ResetTrigger: ['animator'],
  IsParameterControlledByCurve: ['animator'],
  Play: ['animator'],
  PlayInFixedTime: ['animator'],
  CrossFade: ['animator'],
  CrossFadeInFixedTime: ['animator'],
  SetInt: ['shader'],
  GetInt: ['shader'],
  SetColor: ['shader'],
  GetColor: ['shader'],
  SetVector: ['shader'],
  GetVector: ['shader'],
  SetTexture: ['shader'],
  GetTexture: ['shader'],
  SetMatrix: ['shader'],
  GetMatrix: ['shader'],
  SetBuffer: ['shader'],
  SetConstantBuffer: ['shader'],
  SetFloatArray: ['shader'],
  SetVectorArray: ['shader'],
  SetMatrixArray: ['shader'],
  SetTextureOffset: ['shader'],
  SetTextureScale: ['shader'],
  GetTextureOffset: ['shader'],
  GetTextureScale: ['shader'],
  HasProperty: ['shader'],
  SetGlobalFloat: ['shader'],
  SetGlobalInt: ['shader'],
  SetGlobalInteger: ['shader'],
  SetGlobalColor: ['shader'],
  SetGlobalVector: ['shader'],
  SetGlobalTexture: ['shader'],
  SetGlobalMatrix: ['shader'],
  SetGlobalBuffer: ['shader']
}

/** Receiver types whose string overloads should use a cached id. */
export const UNITY_PROPERTY_ID_RECEIVER_TYPES: Record<string, UnityPropertyIdKind> = {
  Animator: 'animator',
  Material: 'shader',
  MaterialPropertyBlock: 'shader',
  Shader: 'shader',
  ComputeShader: 'shader',
  CommandBuffer: 'shader'
}

export const UNITY_PROPERTY_ID_HELPERS: Record<UnityPropertyIdKind, string> = {
  animator: 'Animator.StringToHash',
  shader: 'Shader.PropertyToID'
}
