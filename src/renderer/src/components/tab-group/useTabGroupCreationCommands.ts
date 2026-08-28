import { useCallback } from 'react'
import { toast } from 'sonner'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { useAppStore } from '../../store'
import { focusTerminalTabSurface } from '../../lib/focus-terminal-tab-surface'
import {
  createWebRuntimeSessionBrowserTab,
  createWebRuntimeSessionTerminal,
  isWebRuntimeSessionActive
} from '../../runtime/web-runtime-session'
import { openTabBarEntry, type TabCreateEntryArgs } from '../tab-bar/tab-create-entry-action'
import { openMobileEmulatorTab } from '@/lib/open-mobile-emulator-tab'
import { openPopupTerminal } from '@/lib/open-popup-terminal'
import { ensureSimulatorTab, getSimulatorTabForWorktree } from '@/lib/ensure-simulator-tab'
import { buildDuplicatedBrowserTabOptions } from '@/lib/duplicate-browser-tab-options'
import {
  getExecutionHostIdForWorktree,
  getRuntimeEnvironmentIdForWorktree
} from '@/lib/worktree-runtime-owner'
import { isEmbeddedEditorSupported } from '@/lib/embedded-editor-support'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { getRepoIdFromWorktreeId } from '../../../../shared/worktree/id'
import { translate } from '@/i18n/i18n'
import { browserWorkspaceHasRemoteOwner } from '@/runtime/remote-browser-tab-ownership'
import { getClientCreationActionPolicy } from '@/lib/client-creation-action-policy'
import { getRendererAppPlatform } from '@/lib/renderer-app-platform'
import type { TabGroupWorktreeSnapshot } from './useTabGroupItemProjections'

export function recordTerminalTabGroupSplit(createdTerminal: TerminalTab | null | undefined): void {
  if (!createdTerminal) {
    return
  }
  useAppStore.getState().recordFeatureInteraction('terminal-pane-split')
}

export function useTabGroupCreationCommands({
  groupId,
  worktreeId,
  worktreeState
}: {
  groupId: string
  worktreeId: string
  worktreeState: TabGroupWorktreeSnapshot
}) {
  const focusGroup = useAppStore((state) => state.focusGroup)
  const createTab = useAppStore((state) => state.createTab)
  const setActiveTab = useAppStore((state) => state.setActiveTab)
  const setActiveTabType = useAppStore((state) => state.setActiveTabType)
  const createBrowserTab = useAppStore((state) => state.createBrowserTab)
  const createCodeServerTab = useAppStore((state) => state.createCodeServerTab)
  const createDataStudioTab = useAppStore((state) => state.createDataStudioTab)
  const createEmptySplitGroup = useAppStore((state) => state.createEmptySplitGroup)
  const openNewBrowserTabInActiveWorkspace = useAppStore(
    (state) => state.openNewBrowserTabInActiveWorkspace
  )
  const openNewMarkdownInActiveWorkspace = useAppStore(
    (state) => state.openNewMarkdownInActiveWorkspace
  )
  const openNewScratchFileInActiveWorkspace = useAppStore(
    (state) => state.openNewScratchFileInActiveWorkspace
  )
  const openNewTerminalTabInActiveWorkspace = useAppStore(
    (state) => state.openNewTerminalTabInActiveWorkspace
  )

  const createSplitGroup = useCallback(
    (direction: 'left' | 'right' | 'up' | 'down') => {
      focusGroup(worktreeId, groupId)
      const newGroupId = createEmptySplitGroup(worktreeId, groupId, direction)
      if (!newGroupId) {
        return
      }
      // Why: this Split entry point always seeds a fresh terminal (tab-drag can open other directions).
      const terminal = createTab(worktreeId, newGroupId)
      recordTerminalTabGroupSplit(terminal)
      setActiveTab(terminal.id)
      setActiveTabType('terminal')
    },
    [
      createEmptySplitGroup,
      createTab,
      focusGroup,
      groupId,
      setActiveTab,
      setActiveTabType,
      worktreeId
    ]
  )

  // Why: these stay unmemoized plain lambdas — the original built them inline in the returned commands object.
  return {
    createSplitGroup,
    newBrowserTab: () => {
      void openNewBrowserTabInActiveWorkspace(groupId).catch((error) => {
        toast.error(error instanceof Error ? error.message : String(error))
      })
    },
    newVSCodeTab: () => {
      const state = useAppStore.getState()
      // Real safety boundary: code-server only runs against local checkouts
      // (menu gating is just UX; SSH/remote case included).
      const isLocal = getExecutionHostIdForWorktree(state, worktreeId) === LOCAL_EXECUTION_HOST_ID
      if (!isLocal || !isEmbeddedEditorSupported()) {
        return
      }
      const worktree = state.getKnownWorktreeById(worktreeId)
      const folderPath = worktree?.path
      if (!folderPath) {
        return
      }
      // Every embedded editor tab reads "VS Code" — the title never varies per worktree.
      createCodeServerTab(
        worktreeId,
        folderPath,
        translate('auto.components.tab.bar.CodeServerTab.title', 'VS Code')
      )
    },
    newDataStudioTab: () => {
      const state = useAppStore.getState()
      const platform = getRendererAppPlatform()
      // Real safety boundary: the per-repo ADS server only runs against local
      // checkouts (menu gating is just UX; SSH/remote case included).
      const isLocal = getExecutionHostIdForWorktree(state, worktreeId) === LOCAL_EXECUTION_HOST_ID
      if (!isLocal || (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32')) {
        return
      }
      const worktree = state.getKnownWorktreeById(worktreeId)
      const folderPath = worktree?.path
      // Connections are per repo; a workspace without a real repo (group folder
      // workspaces) has nowhere to scope them.
      const repoId = getRepoIdFromWorktreeId(worktreeId)
      if (!folderPath || !state.repos.some((repo) => repo.id === repoId)) {
        return
      }
      createDataStudioTab(
        worktreeId,
        repoId,
        folderPath,
        translate('auto.components.tab.bar.DataStudioTab.title', 'Data Studio')
      )
    },
    newSimulatorTab: worktreeState.mobileEmulatorEnabled
      ? () => {
          if (getSimulatorTabForWorktree(worktreeId)) {
            void ensureSimulatorTab(worktreeId, { surfacePane: true })
            return
          }
          // Why: mobile simulators are most useful beside the current tab group.
          void openMobileEmulatorTab(worktreeId, {
            placement: 'rightSplit',
            targetGroupId: groupId
          }).catch((error) => {
            toast.error(error instanceof Error ? error.message : String(error))
          })
        }
      : undefined,
    openEntry: async (args: TabCreateEntryArgs) => {
      await openTabBarEntry(args)
    },
    duplicateBrowserTab: (browserTabId: string) => {
      void (async () => {
        const state = useAppStore.getState()
        const tabs = state.browserTabsByWorktree[worktreeId] ?? []
        const source = tabs.find((t) => t.id === browserTabId)
        if (!source) {
          return
        }
        const runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(state, worktreeId)
        const browserAvailability = getClientCreationActionPolicy(state, worktreeId)[
          'managed-browser'
        ]
        if (browserAvailability.state !== 'enabled') {
          throw new Error(browserAvailability.reason)
        }
        if (
          browserAvailability.provider === 'paired-runtime' &&
          browserWorkspaceHasRemoteOwner(state, source.id, runtimeEnvironmentId)
        ) {
          const created = await createWebRuntimeSessionBrowserTab({
            worktreeId,
            environmentId: runtimeEnvironmentId,
            url: source.url,
            profileId: source.sessionProfileId,
            targetGroupId: groupId
          })
          if (created) {
            return
          }
          throw new Error('The paired runtime could not duplicate the managed browser tab.')
        }
        createBrowserTab(worktreeId, source.url, {
          ...buildDuplicatedBrowserTabOptions(source),
          ...(runtimeEnvironmentId ? { browserRuntimeEnvironmentId: null } : {}),
          targetGroupId: groupId
        })
      })().catch((error) => {
        toast.error(error instanceof Error ? error.message : String(error))
      })
    },
    // Why: target the owning group explicitly; the "+" menu can fire from an unfocused panel without updating global group focus.
    newFileTab: async () => {
      await openNewMarkdownInActiveWorkspace(groupId)
    },
    newScratchFileTab: async () => {
      await openNewScratchFileInActiveWorkspace(groupId)
    },
    newTerminalTab: () => {
      void openNewTerminalTabInActiveWorkspace(groupId)
    },
    newPopupTerminal: () => {
      openPopupTerminal(worktreeId)
    },
    newTerminalWithShell: (shellOverride: string) => {
      void (async () => {
        const environmentId = getRuntimeEnvironmentIdForWorktree(useAppStore.getState(), worktreeId)
        const outcome = await createWebRuntimeSessionTerminal({
          worktreeId,
          environmentId,
          targetGroupId: groupId,
          command: shellOverride,
          activate: true
        })
        if (outcome.status === 'created' || isWebRuntimeSessionActive(environmentId)) {
          return
        }
        const terminal = createTab(worktreeId, groupId, shellOverride)
        setActiveTab(terminal.id)
        setActiveTabType('terminal')
        focusTerminalTabSurface(terminal.id)
      })()
    }
  }
}
