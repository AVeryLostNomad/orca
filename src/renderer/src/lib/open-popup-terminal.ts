import { useAppStore } from '@/store'
import { createBrowserUuid } from '@/lib/browser-uuid'

/** Opens an ephemeral terminal over a real workspace without adding a tab. */
export function openPopupTerminal(worktreeId?: string | null): boolean {
  const state = useAppStore.getState()
  const targetWorktreeId = worktreeId ?? state.activeWorktreeId
  if (!targetWorktreeId) {
    return false
  }

  state.openQuickCommandModal({
    requestId: createBrowserUuid(),
    worktreeId: targetWorktreeId,
    cwd: state.getKnownWorktreeById(targetWorktreeId)?.path ?? null
  })
  return true
}

/** Toggles the interactive popup without disturbing command-owned popups. */
export function togglePopupTerminal(worktreeId?: string | null): boolean {
  const state = useAppStore.getState()
  if (state.quickCommandModal) {
    if (state.quickCommandModal.command) {
      return false
    }
    state.closeQuickCommandModal()
    return true
  }
  return openPopupTerminal(worktreeId)
}
