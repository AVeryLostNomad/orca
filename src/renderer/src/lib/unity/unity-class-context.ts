import type {
  CSharpBaseType,
  CSharpOutline,
  CSharpTypeDeclaration
} from './csharp-syntax-outline-types'
import { lookupOwn } from './csharp-lexer'
import type { UnityBaseKind } from './unity-event-function-types'

/** Fully-qualified Unity (and common package) types mapped to the message family they get. */
const UNITY_BASE_KIND_BY_QUALIFIED_NAME: Record<string, UnityBaseKind> = {
  'UnityEngine.MonoBehaviour': 'MonoBehaviour',
  'UnityEngine.ScriptableObject': 'ScriptableObject',
  'UnityEngine.StateMachineBehaviour': 'StateMachineBehaviour',
  'UnityEditor.Editor': 'Editor',
  'UnityEditor.EditorWindow': 'EditorWindow',
  'UnityEditor.AssetPostprocessor': 'AssetPostprocessor',
  'UnityEditor.ScriptableSingleton': 'ScriptableObject',
  'UnityEditor.SearchableEditorWindow': 'EditorWindow',
  'UnityEngine.EventSystems.UIBehaviour': 'MonoBehaviour',
  'UnityEngine.EventSystems.EventSystem': 'MonoBehaviour',
  'UnityEngine.EventSystems.EventTrigger': 'MonoBehaviour',
  'UnityEngine.EventSystems.BaseInputModule': 'MonoBehaviour',
  'UnityEngine.EventSystems.PointerInputModule': 'MonoBehaviour',
  'UnityEngine.EventSystems.StandaloneInputModule': 'MonoBehaviour',
  'UnityEngine.EventSystems.BaseRaycaster': 'MonoBehaviour',
  'UnityEngine.EventSystems.PhysicsRaycaster': 'MonoBehaviour',
  'UnityEngine.EventSystems.Physics2DRaycaster': 'MonoBehaviour',
  'UnityEngine.UI.Selectable': 'MonoBehaviour',
  'UnityEngine.UI.Button': 'MonoBehaviour',
  'UnityEngine.UI.Toggle': 'MonoBehaviour',
  'UnityEngine.UI.ToggleGroup': 'MonoBehaviour',
  'UnityEngine.UI.Slider': 'MonoBehaviour',
  'UnityEngine.UI.Scrollbar': 'MonoBehaviour',
  'UnityEngine.UI.Dropdown': 'MonoBehaviour',
  'UnityEngine.UI.InputField': 'MonoBehaviour',
  'UnityEngine.UI.ScrollRect': 'MonoBehaviour',
  'UnityEngine.UI.Graphic': 'MonoBehaviour',
  'UnityEngine.UI.MaskableGraphic': 'MonoBehaviour',
  'UnityEngine.UI.Image': 'MonoBehaviour',
  'UnityEngine.UI.RawImage': 'MonoBehaviour',
  'UnityEngine.UI.Text': 'MonoBehaviour',
  'UnityEngine.UI.Mask': 'MonoBehaviour',
  'UnityEngine.UI.RectMask2D': 'MonoBehaviour',
  'UnityEngine.UI.LayoutGroup': 'MonoBehaviour',
  'UnityEngine.UI.HorizontalOrVerticalLayoutGroup': 'MonoBehaviour',
  'UnityEngine.UI.HorizontalLayoutGroup': 'MonoBehaviour',
  'UnityEngine.UI.VerticalLayoutGroup': 'MonoBehaviour',
  'UnityEngine.UI.GridLayoutGroup': 'MonoBehaviour',
  'UnityEngine.UI.LayoutElement': 'MonoBehaviour',
  'UnityEngine.UI.ContentSizeFitter': 'MonoBehaviour',
  'UnityEngine.UI.AspectRatioFitter': 'MonoBehaviour',
  'UnityEngine.UI.CanvasScaler': 'MonoBehaviour',
  'UnityEngine.UI.GraphicRaycaster': 'MonoBehaviour',
  'UnityEngine.UI.BaseMeshEffect': 'MonoBehaviour',
  'UnityEngine.UI.Shadow': 'MonoBehaviour',
  'UnityEngine.UI.Outline': 'MonoBehaviour',
  'TMPro.TMP_Text': 'MonoBehaviour',
  'TMPro.TextMeshProUGUI': 'MonoBehaviour',
  'TMPro.TextMeshPro': 'MonoBehaviour',
  'TMPro.TMP_InputField': 'MonoBehaviour',
  'TMPro.TMP_Dropdown': 'MonoBehaviour',
  'Unity.Netcode.NetworkBehaviour': 'MonoBehaviour',
  'Mirror.NetworkBehaviour': 'MonoBehaviour',
  'Fusion.NetworkBehaviour': 'MonoBehaviour',
  'Fusion.SimulationBehaviour': 'MonoBehaviour',
  'Photon.Pun.MonoBehaviourPun': 'MonoBehaviour',
  'Photon.Pun.MonoBehaviourPunCallbacks': 'MonoBehaviour',
  'UnityEngine.Playables.PlayableAsset': 'ScriptableObject',
  'UnityEngine.Timeline.TrackAsset': 'ScriptableObject',
  'UnityEngine.Rendering.RenderPipelineAsset': 'ScriptableObject',
  'UnityEngine.Rendering.VolumeComponent': 'ScriptableObject',
  'UnityEngine.Rendering.Universal.ScriptableRendererFeature': 'ScriptableObject'
}

export function unityBaseKindForQualifiedName(qualifiedName: string): UnityBaseKind | null {
  return lookupOwn(UNITY_BASE_KIND_BY_QUALIFIED_NAME, qualifiedName.replace(/<.*$/, '')) ?? null
}

/** Qualified names a written base type may refer to, given the file's usings and namespace. */
export function candidateQualifiedNames(
  base: CSharpBaseType,
  outline: CSharpOutline,
  type: CSharpTypeDeclaration
): string[] {
  const written = base.text.replace(/<.*$/, '').replace(/^global::/, '')
  const candidates = [written]
  for (
    let ns = type.namespace;
    ns;
    ns = ns.includes('.') ? ns.slice(0, ns.lastIndexOf('.')) : null
  ) {
    candidates.push(`${ns}.${written}`)
  }
  for (const using of outline.usings) {
    candidates.push(`${using}.${written}`)
  }
  return candidates
}

export type UnityTypeSource = {
  type: CSharpTypeDeclaration
  outline: CSharpOutline
  /** Absolute path of the declaring file, when it is on disk. */
  filePath: string | null
}

export type UnityClassResolver = {
  /** Fully-qualified name of a base type as a language server sees it. */
  qualifiedBaseName?: (source: UnityTypeSource, base: CSharpBaseType) => Promise<string | null>
  /** Locate a user-declared type by simple name (other files, open models, workspace). */
  findType: (
    simpleName: string,
    base: CSharpBaseType,
    from: UnityTypeSource
  ) => Promise<UnityTypeSource | null>
}

export type UnityClassResolution = {
  kind: UnityBaseKind | null
  /** True when a link in the chain could not be found, so `null` is not authoritative. */
  incomplete: boolean
}

const MAX_INHERITANCE_DEPTH = 12

/** Walk the base-class chain of `root` until a known Unity base type is reached. */
export async function resolveUnityClassKind(
  root: UnityTypeSource,
  resolver: UnityClassResolver
): Promise<UnityClassResolution> {
  const visited = new Set<CSharpTypeDeclaration>()
  let current: UnityTypeSource | null = root
  for (let depth = 0; current && depth < MAX_INHERITANCE_DEPTH; depth++) {
    if (visited.has(current.type)) {
      return { kind: null, incomplete: false }
    }
    visited.add(current.type)
    // Only a class's first base can be a class; interfaces follow.
    const base: CSharpBaseType | undefined =
      current.type.kind === 'class' ? current.type.baseTypes[0] : undefined
    if (!base) {
      return { kind: null, incomplete: false }
    }
    const qualified = resolver.qualifiedBaseName
      ? await resolver.qualifiedBaseName(current, base)
      : null
    if (qualified) {
      const kind = unityBaseKindForQualifiedName(qualified)
      if (kind) {
        return { kind, incomplete: false }
      }
    }
    // Types declared in the same file shadow imported namespaces.
    const sameFile = base.text.includes('.')
      ? undefined
      : current.outline.types.find((t) => t.name === base.name && t !== current?.type)
    // A server-resolved non-Unity name rules out textual using-guesses for this link.
    if (!sameFile && !qualified) {
      for (const candidate of candidateQualifiedNames(base, current.outline, current.type)) {
        const kind = unityBaseKindForQualifiedName(candidate)
        if (kind) {
          return { kind, incomplete: false }
        }
      }
    }
    const next: UnityTypeSource | null = sameFile
      ? { type: sameFile, outline: current.outline, filePath: current.filePath }
      : await resolver.findType(base.name, base, current)
    if (!next) {
      // Interfaces conventionally start with `I` + uppercase; anything else is an unknown class.
      return { kind: null, incomplete: !/^I[A-Z]/.test(base.name) }
    }
    current = next
  }
  return { kind: null, incomplete: true }
}
