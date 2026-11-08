import { useSyncExternalStore } from 'react'

export type UnityPanelSection = 'console' | 'tests'

export const UNITY_PANEL_SHOW_EVENT = 'orca:unity-panel-show'

let currentSection: UnityPanelSection = 'console'
const listeners = new Set<() => void>()

export function setUnityPanelSection(section: UnityPanelSection): void {
  if (section === currentSection) {
    return
  }
  currentSection = section
  for (const listener of listeners) {
    listener()
  }
}

// Why module scope: revealers dispatch in the same tick that first mounts the lazy panel, before it can listen.
if (typeof window !== 'undefined') {
  window.addEventListener(UNITY_PANEL_SHOW_EVENT, (event) => {
    const section = event instanceof CustomEvent ? event.detail?.section : undefined
    if (section === 'console' || section === 'tests') {
      setUnityPanelSection(section)
    }
  })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Section shown by the Unity panel; survives remounts and follows `orca:unity-panel-show`. */
export function useUnityPanelSection(): UnityPanelSection {
  const getSnapshot = (): UnityPanelSection => currentSection
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
