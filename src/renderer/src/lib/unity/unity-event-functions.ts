import {
  ASSET_POSTPROCESSOR_MESSAGES,
  EDITOR_MESSAGES,
  EDITOR_WINDOW_MESSAGES,
  SCRIPTABLE_OBJECT_MESSAGES
} from './unity-editor-messages'
import type { UnityBaseKind, UnityEventFunction } from './unity-event-function-types'
import { MONO_BEHAVIOUR_MESSAGES } from './unity-mono-behaviour-messages'

function mergeMessages(...layers: UnityEventFunction[][]): UnityEventFunction[] {
  const byName = new Map<string, UnityEventFunction>()
  // Earlier layers are more derived and win.
  for (const layer of layers) {
    for (const message of layer) {
      if (!byName.has(message.name)) {
        byName.set(message.name, message)
      }
    }
  }
  return [...byName.values()]
}

export const UNITY_EVENT_FUNCTIONS: Record<UnityBaseKind, UnityEventFunction[]> = {
  MonoBehaviour: MONO_BEHAVIOUR_MESSAGES,
  ScriptableObject: SCRIPTABLE_OBJECT_MESSAGES,
  Editor: mergeMessages(EDITOR_MESSAGES, SCRIPTABLE_OBJECT_MESSAGES),
  EditorWindow: mergeMessages(EDITOR_WINDOW_MESSAGES, SCRIPTABLE_OBJECT_MESSAGES),
  // Its OnStateEnter/... are virtual overrides, not messages.
  StateMachineBehaviour: SCRIPTABLE_OBJECT_MESSAGES,
  AssetPostprocessor: ASSET_POSTPROCESSOR_MESSAGES
}

export function formatUnityEventSignature(
  message: UnityEventFunction,
  options?: { coroutine?: boolean }
): string {
  const parameters = message.parameters.map((p) => `${p.type} ${p.name}`).join(', ')
  const returnType = options?.coroutine ? 'IEnumerator' : message.returnType
  return `${message.isStatic ? 'static ' : ''}${returnType} ${message.name}(${parameters})`
}
