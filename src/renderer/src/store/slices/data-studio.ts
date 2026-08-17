import type { StateCreator } from 'zustand'
import type { DataStudioStatusEvent, DataStudioTab } from '../../../../shared/data-studio-types'
import type { WorkspaceSessionState } from '../../../../shared/workspace-session-state-types'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type { AppState } from '../types'

export type DataStudioSlice = {
  dataStudioTabsByWorktree: Record<string, DataStudioTab[]>
  activeDataStudioTabIdByWorktree: Record<string, string | null>
  /** Data Studio runs one server per repo, so status/port are repo-keyed. */
  dataStudioStatusByRepo: Record<string, DataStudioStatusEvent>
  createDataStudioTab: (
    worktreeId: string,
    repoId: string,
    folderPath: string,
    label: string
  ) => DataStudioTab
  closeDataStudioTab: (id: string) => void
  setActiveDataStudioTab: (id: string) => void
  setDataStudioStatus: (event: DataStudioStatusEvent) => void
  hydrateDataStudioSession: (session: WorkspaceSessionState) => void
}

export const createDataStudioSlice: StateCreator<AppState, [], [], DataStudioSlice> = (
  set,
  get
) => ({
  dataStudioTabsByWorktree: {},
  activeDataStudioTabIdByWorktree: {},
  dataStudioStatusByRepo: {},

  createDataStudioTab: (worktreeId, repoId, folderPath, label) => {
    // One Data Studio tab per worktree: reopen focuses the existing tab (the
    // repo's shared server would just open the same folder again).
    const existing = (get().dataStudioTabsByWorktree[worktreeId] ?? [])[0]
    if (existing) {
      get().setActiveDataStudioTab(existing.id)
      return existing
    }
    const tab: DataStudioTab = { id: createBrowserUuid(), worktreeId, repoId, folderPath, label }
    set((state) => ({
      dataStudioTabsByWorktree: {
        ...state.dataStudioTabsByWorktree,
        [worktreeId]: [tab]
      },
      activeDataStudioTabIdByWorktree: {
        ...state.activeDataStudioTabIdByWorktree,
        [worktreeId]: tab.id
      }
    }))
    get().createUnifiedTab(worktreeId, 'datastudio', {
      entityId: tab.id,
      label: tab.label,
      activate: true
    })
    return tab
  },

  closeDataStudioTab: (id) => {
    const worktreeId = Object.keys(get().dataStudioTabsByWorktree).find((wt) =>
      (get().dataStudioTabsByWorktree[wt] ?? []).some((tab) => tab.id === id)
    )
    if (!worktreeId) {
      return
    }
    set((state) => {
      const remaining = (state.dataStudioTabsByWorktree[worktreeId] ?? []).filter(
        (tab) => tab.id !== id
      )
      return {
        dataStudioTabsByWorktree: {
          ...state.dataStudioTabsByWorktree,
          [worktreeId]: remaining
        },
        activeDataStudioTabIdByWorktree: {
          ...state.activeDataStudioTabIdByWorktree,
          [worktreeId]: remaining[0]?.id ?? null
        }
      }
    })
    for (const tabs of Object.values(get().unifiedTabsByWorktree)) {
      const item = tabs.find((entry) => entry.contentType === 'datastudio' && entry.entityId === id)
      if (item) {
        get().closeUnifiedTab(item.id)
      }
    }
  },

  setActiveDataStudioTab: (id) => {
    const worktreeId = Object.keys(get().dataStudioTabsByWorktree).find((wt) =>
      (get().dataStudioTabsByWorktree[wt] ?? []).some((tab) => tab.id === id)
    )
    if (worktreeId) {
      set((state) => ({
        activeDataStudioTabIdByWorktree: {
          ...state.activeDataStudioTabIdByWorktree,
          [worktreeId]: id
        }
      }))
    }
    const item = Object.values(get().unifiedTabsByWorktree)
      .flat()
      .find((entry) => entry.contentType === 'datastudio' && entry.entityId === id)
    if (item) {
      get().activateTab(item.id)
    }
  },

  setDataStudioStatus: (event) =>
    set((state) => ({
      dataStudioStatusByRepo: {
        ...state.dataStudioStatusByRepo,
        [event.repoId]: event
      }
    })),

  hydrateDataStudioSession: (session) => {
    set({
      dataStudioTabsByWorktree: session.dataStudioTabsByWorktree ?? {},
      activeDataStudioTabIdByWorktree: session.activeDataStudioTabIdByWorktree ?? {}
    })
    // Backfill unified tabs: hydrateTabsSession runs first and may not know
    // about tabs whose backing entity (this slice) hydrates afterward.
    const state = get()
    for (const [worktreeId, tabs] of Object.entries(state.dataStudioTabsByWorktree)) {
      for (const tab of tabs) {
        const exists = (state.unifiedTabsByWorktree[worktreeId] ?? []).some(
          (t) => t.contentType === 'datastudio' && t.entityId === tab.id
        )
        if (!exists) {
          state.createUnifiedTab(worktreeId, 'datastudio', {
            entityId: tab.id,
            label: tab.label,
            recordInteraction: false
          })
        }
      }
    }
  }
})
