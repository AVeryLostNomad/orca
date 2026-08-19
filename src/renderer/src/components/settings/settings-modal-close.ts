import { useAppStore } from '@/store'

type SettingsModalCloseHandler = () => Promise<void> | void

let activeHandler: SettingsModalCloseHandler | null = null

/**
 * Why: the unsaved-prompt discard guard lives inside the lazily-mounted
 * Settings tree, but Escape/outside-click land on the modal shell. The shell
 * routes closes through the registered guard so both paths confirm discards.
 */
export function registerSettingsModalCloseHandler(handler: SettingsModalCloseHandler): () => void {
  activeHandler = handler
  return () => {
    if (activeHandler === handler) {
      activeHandler = null
    }
  }
}

// Why: the shell preventDefaults Escape to stop Radix's instant dismiss, but
// Settings' document handler must still treat that event as unhandled — only
// inner widgets (Selects, menus) preventing Escape should defer the close.
const shellPreventedEscapes = new WeakSet<Event>()

export function markSettingsModalEscapePrevented(event: Event): void {
  shellPreventedEscapes.add(event)
}

export function wasSettingsModalEscapePrevented(event: Event): boolean {
  return shellPreventedEscapes.has(event)
}

export function requestSettingsModalClose(): void {
  if (activeHandler) {
    void activeHandler()
    return
  }
  // Settings still Suspense-pending: nothing to guard yet.
  useAppStore.getState().closeSettingsPage()
}
