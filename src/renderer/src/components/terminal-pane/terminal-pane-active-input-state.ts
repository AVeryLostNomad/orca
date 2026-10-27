import { useEffect } from 'react'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import type { PtyTransport } from './pty-transport-types'
import type { TerminalPaneActiveInputState } from './terminal-pane-types'

type ActiveInputStateReader = () => TerminalPaneActiveInputState | null

const readersByTabId = new Map<string, ActiveInputStateReader>()

function registerTerminalPaneActiveInputStateReader(
  tabId: string,
  read: ActiveInputStateReader
): () => void {
  readersByTabId.set(tabId, read)
  return () => {
    if (readersByTabId.get(tabId) === read) {
      readersByTabId.delete(tabId)
    }
  }
}

/** Input mode of the active split in `tabId`'s mounted pane; null when no pane is mounted. */
export function readTerminalPaneActiveInputState(
  tabId: string
): TerminalPaneActiveInputState | null {
  return readersByTabId.get(tabId)?.() ?? null
}

/** Popup hosts ask whether Escape belongs to the PTY (full-screen TUI) before closing. */
export function useTerminalPaneActiveInputStateReader(
  tabId: string,
  managerRef: React.RefObject<PaneManager | null>,
  paneTransportsRef: React.RefObject<Map<number, PtyTransport>>
): void {
  useEffect(
    () =>
      registerTerminalPaneActiveInputStateReader(tabId, () => {
        const manager = managerRef.current
        const pane = manager?.getActivePane() ?? manager?.getPanes()[0]
        if (!pane) {
          return null
        }
        return {
          ptyId: paneTransportsRef.current.get(pane.id)?.getPtyId() ?? null,
          isAlternateScreen: pane.terminal.buffer.active.type === 'alternate'
        }
      }),
    [managerRef, paneTransportsRef, tabId]
  )
}
