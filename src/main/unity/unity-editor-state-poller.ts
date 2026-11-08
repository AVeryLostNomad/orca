import type { UnityEditorState } from '../../shared/unity-types'
import { getUnityEditorState, unityProjectKey } from './unity-editor-bridge'

// Connected polls hit the editor's loopback status endpoint (no process spawn).
const CONNECTED_POLL_MS = 3_000
// Disconnected polls may need `unity status` for projects without the Pipeline package.
const DISCONNECTED_POLL_MS = 8_000

type Watch = {
  projectRoot: string
  subscribers: Map<string, (state: UnityEditorState) => void>
  timer: NodeJS.Timeout | null
  polling: boolean
  lastState: UnityEditorState | null
  lastJson: string | null
}

const watches = new Map<string, Watch>()

async function poll(key: string, watch: Watch): Promise<void> {
  if (watch.polling) {
    return
  }
  watch.polling = true
  let state: UnityEditorState
  try {
    state = await getUnityEditorState(watch.projectRoot)
  } catch {
    state = { connected: false, cliAvailable: false, projectRoot: watch.projectRoot }
  } finally {
    watch.polling = false
  }
  if (watches.get(key) !== watch) {
    return
  }
  const json = JSON.stringify(state)
  if (json !== watch.lastJson) {
    watch.lastJson = json
    watch.lastState = state
    for (const send of watch.subscribers.values()) {
      send(state)
    }
  }
  watch.timer = setTimeout(
    () => void poll(key, watch),
    state.connected ? CONNECTED_POLL_MS : DISCONNECTED_POLL_MS
  )
}

/** Starts polling on the first subscriber of a project; emits only when the state changes. */
export function watchUnityEditorState(
  projectRoot: string,
  subscriberKey: string,
  send: (state: UnityEditorState) => void
): void {
  const key = unityProjectKey(projectRoot)
  let watch = watches.get(key)
  if (!watch) {
    watch = {
      projectRoot,
      subscribers: new Map(),
      timer: null,
      polling: false,
      lastState: null,
      lastJson: null
    }
    watches.set(key, watch)
    watch.subscribers.set(subscriberKey, send)
    void poll(key, watch)
    return
  }
  watch.subscribers.set(subscriberKey, send)
  if (watch.lastState) {
    send(watch.lastState)
  }
}

export function unwatchUnityEditorState(subscriberKey: string): void {
  for (const [key, watch] of watches) {
    if (watch.subscribers.delete(subscriberKey) && watch.subscribers.size === 0) {
      if (watch.timer) {
        clearTimeout(watch.timer)
      }
      watches.delete(key)
    }
  }
}

/** Drops every subscription owned by a destroyed renderer (keys are prefixed `<webContentsId>:`). */
export function unwatchUnityEditorStateForOwner(ownerPrefix: string): void {
  for (const watch of watches.values()) {
    for (const subscriberKey of watch.subscribers.keys()) {
      if (subscriberKey.startsWith(ownerPrefix)) {
        unwatchUnityEditorState(subscriberKey)
      }
    }
  }
}

/** Re-polls now (e.g. right after a play/stop action) instead of waiting for the next tick. */
export function refreshUnityEditorState(projectRoot: string): void {
  const key = unityProjectKey(projectRoot)
  const watch = watches.get(key)
  if (!watch || watch.polling) {
    return
  }
  if (watch.timer) {
    clearTimeout(watch.timer)
    watch.timer = null
  }
  void poll(key, watch)
}
