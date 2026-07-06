import type { StateCreator } from 'zustand'
import type { CodeServerStatus, CodeServerStatusEvent } from '../../../../shared/code-server-types'
import type { CodeServerTab, WorkspaceSessionState } from '../../../../shared/types'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type { AppState } from '../types'

export type CodeServerSlice = {
  codeServerTabsByWorktree: Record<string, CodeServerTab[]>
  activeCodeServerTabIdByWorktree: Record<string, string | null>
  codeServerStatus: CodeServerStatus
  codeServerPort: number | null
  createCodeServerTab: (worktreeId: string, folderPath: string, label: string) => CodeServerTab
  closeCodeServerTab: (id: string) => void
  setActiveCodeServerTab: (id: string) => void
  setCodeServerStatus: (event: CodeServerStatusEvent) => void
  hydrateCodeServerSession: (session: WorkspaceSessionState) => void
}

export const createCodeServerSlice: StateCreator<AppState, [], [], CodeServerSlice> = (
  set,
  get
) => ({
  codeServerTabsByWorktree: {},
  activeCodeServerTabIdByWorktree: {},
  codeServerStatus: 'stopped',
  codeServerPort: null,

  createCodeServerTab: (worktreeId, folderPath, label) => {
    // One VSCode tab per worktree: reopen focuses the existing tab (avoids
    // same-folder contention on the shared code-server instance).
    const existing = (get().codeServerTabsByWorktree[worktreeId] ?? [])[0]
    if (existing) {
      get().setActiveCodeServerTab(existing.id)
      return existing
    }
    const tab: CodeServerTab = { id: createBrowserUuid(), worktreeId, folderPath, label }
    set((state) => ({
      codeServerTabsByWorktree: {
        ...state.codeServerTabsByWorktree,
        [worktreeId]: [tab]
      },
      activeCodeServerTabIdByWorktree: {
        ...state.activeCodeServerTabIdByWorktree,
        [worktreeId]: tab.id
      }
    }))
    get().createUnifiedTab(worktreeId, 'vscode', {
      entityId: tab.id,
      label: tab.label,
      activate: true
    })
    return tab
  },

  closeCodeServerTab: (id) => {
    const worktreeId = Object.keys(get().codeServerTabsByWorktree).find((wt) =>
      (get().codeServerTabsByWorktree[wt] ?? []).some((tab) => tab.id === id)
    )
    if (!worktreeId) {
      return
    }
    set((state) => {
      const remaining = (state.codeServerTabsByWorktree[worktreeId] ?? []).filter(
        (tab) => tab.id !== id
      )
      return {
        codeServerTabsByWorktree: {
          ...state.codeServerTabsByWorktree,
          [worktreeId]: remaining
        },
        activeCodeServerTabIdByWorktree: {
          ...state.activeCodeServerTabIdByWorktree,
          [worktreeId]: remaining[0]?.id ?? null
        }
      }
    })
    for (const tabs of Object.values(get().unifiedTabsByWorktree)) {
      const item = tabs.find((entry) => entry.contentType === 'vscode' && entry.entityId === id)
      if (item) {
        get().closeUnifiedTab(item.id)
      }
    }
  },

  setActiveCodeServerTab: (id) => {
    const worktreeId = Object.keys(get().codeServerTabsByWorktree).find((wt) =>
      (get().codeServerTabsByWorktree[wt] ?? []).some((tab) => tab.id === id)
    )
    if (worktreeId) {
      set((state) => ({
        activeCodeServerTabIdByWorktree: {
          ...state.activeCodeServerTabIdByWorktree,
          [worktreeId]: id
        }
      }))
    }
    const item = Object.values(get().unifiedTabsByWorktree)
      .flat()
      .find((entry) => entry.contentType === 'vscode' && entry.entityId === id)
    if (item) {
      get().activateTab(item.id)
    }
  },

  setCodeServerStatus: (event) =>
    set({ codeServerStatus: event.status, codeServerPort: event.port }),

  hydrateCodeServerSession: (session) => {
    set({
      codeServerTabsByWorktree: session.codeServerTabsByWorktree ?? {},
      activeCodeServerTabIdByWorktree: session.activeCodeServerTabIdByWorktree ?? {}
    })
    // Backfill unified tabs: hydrateTabsSession runs first and may not know
    // about tabs whose backing entity (this slice) hydrates afterward.
    const state = get()
    for (const [worktreeId, tabs] of Object.entries(state.codeServerTabsByWorktree)) {
      for (const tab of tabs) {
        const exists = (state.unifiedTabsByWorktree[worktreeId] ?? []).some(
          (t) => t.contentType === 'vscode' && t.entityId === tab.id
        )
        if (!exists) {
          state.createUnifiedTab(worktreeId, 'vscode', {
            entityId: tab.id,
            label: tab.label,
            recordInteraction: false
          })
        }
      }
    }
  }
})
