import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { probePtyRunningWork } from '@/components/terminal/pty-running-work-probe'
import { readTerminalPaneActiveInputState } from '@/components/terminal-pane/terminal-pane-active-input-state'

const ESCAPE_PROBE_TIMEOUT_MS = 1_500

/**
 * Escape reaches the PTY first; the popup closes only when nothing in the
 * terminal could have consumed it: not a full-screen TUI and no foreground
 * program over the shell. An unanswered probe keeps the popup open.
 */
export function closeIfEscapeUnconsumed(
  tabId: string | null,
  requestId: string,
  onClose: () => void
): void {
  const input = tabId ? readTerminalPaneActiveInputState(tabId) : null
  if (!input?.ptyId || input.isAlternateScreen) {
    return
  }
  void probePtyRunningWork([input.ptyId], { timeoutMs: ESCAPE_PROBE_TIMEOUT_MS }).then(
    ([probe]) => {
      // Why: the async probe must not close a different popup opened meanwhile.
      if (
        probe?.verdict === 'exited' &&
        useAppStore.getState().quickCommandModal?.requestId === requestId
      ) {
        onClose()
      }
    }
  )
}

function isModifierOnlyKey(key: string): boolean {
  return key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta'
}

/** "Press any key to close" for a finished task; shortcut chords (copy, select all) pass through. */
export function useCloseOnAnyKey(enabled: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!enabled) {
      return
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isModifierOnlyKey(event.key) || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    // Why: capture on window runs ahead of xterm, which would send the key to a dead PTY.
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [enabled, onClose])
}
