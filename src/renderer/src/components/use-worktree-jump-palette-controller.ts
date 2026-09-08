import { useWorktreeJumpPaletteStoreState } from './use-worktree-jump-palette-store-state'
import { useWorktreeJumpPaletteLocalState } from './use-worktree-jump-palette-local-state'
import { useWorktreeJumpPaletteFilter } from './use-worktree-jump-palette-filter'
import { useWorktreeJumpPaletteWorktrees } from './use-worktree-jump-palette-worktrees'
import { useWorktreeJumpPaletteOpenTabs } from './use-worktree-jump-palette-open-tabs'
import { useWorktreeJumpPaletteRecentTabs } from './use-worktree-jump-palette-recent-tabs'
import { useWorktreeJumpPaletteProjectTargets } from './use-worktree-jump-palette-project-targets'
import { useWorktreeJumpPaletteQuickActions } from './use-worktree-jump-palette-quick-actions'
import { useWorktreeJumpPaletteSections } from './use-worktree-jump-palette-sections'
import { useWorktreeJumpPaletteListEntries } from './use-worktree-jump-palette-list-entries'
import { useWorktreeJumpPaletteSelectionLifecycle } from './use-worktree-jump-palette-selection-lifecycle'
import { useWorktreeJumpPaletteSelectionActions } from './use-worktree-jump-palette-selection-actions'
import { useWorktreeJumpPaletteCreateAction } from './use-worktree-jump-palette-create-action'
import { useWorktreeJumpPaletteTaskUrl } from './use-worktree-jump-palette-task-url'
import { useWorkspaceEmojiShortcodeInput } from '@/components/workspace-emoji/useWorkspaceEmojiShortcodeInput'
import { usePaletteSearchEvaluationContext } from '@/hooks/use-palette-search-evaluation-context'
import type { WorktreePaletteRequestGuard } from '@/lib/worktree-palette-create-action'
import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useCommandBarFiles } from '@/components/cmd-j/use-command-bar-files'
import { launchQuickAi, shouldShowQuickAiRow } from '@/components/cmd-j/quick-ai'
import { parseCommandBarMode } from '@/components/cmd-j/command-bar-mode'
import { detectLanguage } from '@/lib/language-detect'
import { joinPath } from '@/lib/path'
import { translate } from '@/i18n/i18n'
import type { FilePaletteItem } from './worktree-jump-palette-model'

export function useWorktreeJumpPaletteController({
  visible,
  lingering,
  createLookupGuard
}: {
  visible: boolean
  lingering: boolean
  createLookupGuard: WorktreePaletteRequestGuard
}) {
  const storeState = useWorktreeJumpPaletteStoreState({ visible, lingering })
  const localState = useWorktreeJumpPaletteLocalState({ createLookupGuard, visible })
  const [fileModeCleared, setFileModeCleared] = useState(false)
  useEffect(() => {
    setFileModeCleared(false)
  }, [storeState.modalData])
  const paletteEvaluationSnapshot = useMemo(
    () => ({
      query: localState.paletteSearchQuery,
      agentStatus: storeState.agentStatusByPaneKey,
      worktrees: storeState.allWorktrees,
      browserPages: storeState.browserPagesByWorkspace,
      browserWorkspaces: storeState.browserTabsByWorktree,
      openFiles: storeState.openFiles,
      retainedAgents: storeState.retainedAgentsByPaneKey,
      sleepingAgents: storeState.sleepingAgentSessionsByPaneKey,
      unifiedTabs: storeState.unifiedTabsByWorktree,
      visible
    }),
    [
      localState.paletteSearchQuery,
      storeState.agentStatusByPaneKey,
      storeState.allWorktrees,
      storeState.browserPagesByWorkspace,
      storeState.browserTabsByWorktree,
      storeState.openFiles,
      storeState.retainedAgentsByPaneKey,
      storeState.sleepingAgentSessionsByPaneKey,
      storeState.unifiedTabsByWorktree,
      visible
    ]
  )
  const paletteSearchContext = usePaletteSearchEvaluationContext(paletteEvaluationSnapshot)
  const evaluation = { paletteSearchContext }
  const taskUrl = useWorktreeJumpPaletteTaskUrl({
    visible,
    createWorktreeName: localState.createWorktreeName,
    taskSourceUrl: localState.taskSourceUrl,
    createLookupGuard
  })
  const filter = useWorktreeJumpPaletteFilter({ ...storeState, ...localState })
  const worktrees = useWorktreeJumpPaletteWorktrees({
    ...storeState,
    ...localState,
    ...filter,
    ...evaluation
  })
  const openTabs = useWorktreeJumpPaletteOpenTabs({
    ...storeState,
    ...localState,
    ...filter,
    ...worktrees,
    ...evaluation
  })
  const recentTabs = useWorktreeJumpPaletteRecentTabs({
    ...storeState,
    ...localState,
    ...filter,
    ...worktrees,
    ...openTabs
  })
  const projectTargets = useWorktreeJumpPaletteProjectTargets({
    ...storeState,
    ...localState,
    ...filter,
    ...worktrees
  })
  const quickActions = useWorktreeJumpPaletteQuickActions({
    ...storeState,
    ...localState,
    ...worktrees,
    ...openTabs,
    ...projectTargets
  })
  const paletteMode = fileModeCleared ? 'all' : parseCommandBarMode(storeState.modalData)
  const {
    items: fileMatches,
    loading: filesLoading,
    loadError: filesLoadError
  } = useCommandBarFiles({
    enabled: visible && storeState.activeWorktreeId !== null,
    worktreeId: storeState.activeWorktreeId,
    query: localState.deferredQuery,
    limit: paletteMode === 'files' ? 50 : 6
  })
  const fileItems = useMemo<FilePaletteItem[]>(
    () =>
      storeState.activeWorktreeId !== null && (paletteMode === 'files' || worktrees.hasQuery)
        ? fileMatches.map((match) => ({ id: `file:${match.path}`, type: 'file', path: match.path }))
        : [],
    [fileMatches, paletteMode, storeState.activeWorktreeId, worktrees.hasQuery]
  )
  const showQuickAi = useMemo(
    () =>
      shouldShowQuickAiRow({
        query: localState.deferredQuery,
        matchCounts:
          paletteMode === 'files'
            ? { worktrees: 0, openTabs: 0, middle: 0, projectTargets: 0, files: fileItems.length }
            : {
                worktrees: openTabs.worktreeItems.length,
                openTabs: openTabs.openTabItems.length,
                middle: quickActions.middleItems.length,
                projectTargets: projectTargets.projectTargetItems.length,
                files: fileItems.length
              },
        hasUrlIntent: localState.taskSourceUrl !== null,
        eligible: storeState.activeWorktreeId !== null && !worktrees.isLoading
      }),
    [
      fileItems.length,
      localState.deferredQuery,
      openTabs.openTabItems.length,
      paletteMode,
      projectTargets.projectTargetItems.length,
      quickActions.middleItems.length,
      storeState.activeWorktreeId,
      localState.taskSourceUrl,
      worktrees.isLoading,
      openTabs.worktreeItems.length
    ]
  )
  const filePalette = { fileItems, filesLoading, filesLoadError, paletteMode, showQuickAi }
  const sections = useWorktreeJumpPaletteSections({
    ...localState,
    ...filter,
    ...worktrees,
    ...openTabs,
    ...recentTabs,
    ...projectTargets,
    ...quickActions,
    ...taskUrl
  })
  const listEntries = useWorktreeJumpPaletteListEntries({
    ...localState,
    ...worktrees,
    ...openTabs,
    ...sections,
    ...taskUrl,
    ...filePalette
  })
  const selectionLifecycle = useWorktreeJumpPaletteSelectionLifecycle({
    ...storeState,
    ...localState,
    ...filter,
    ...worktrees,
    ...openTabs,
    ...recentTabs,
    ...projectTargets,
    ...quickActions,
    ...sections,
    ...listEntries,
    ...filePalette,
    ...taskUrl
  })
  const selectionActions = useWorktreeJumpPaletteSelectionActions({
    ...storeState,
    ...localState,
    ...quickActions,
    ...selectionLifecycle
  })
  const emojiInput = useWorkspaceEmojiShortcodeInput({
    inputRef: localState.inputRef,
    onValueChange: selectionLifecycle.handleQueryChange,
    value: localState.query
  })
  const handlePaletteInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      emojiInput.handleKeyDown(event)
      if (paletteMode === 'files' && event.key === 'Backspace' && localState.query.length === 0) {
        setFileModeCleared(true)
      }
    },
    [emojiInput, localState.query.length, paletteMode]
  )
  const createAction = useWorktreeJumpPaletteCreateAction({
    ...storeState,
    ...localState,
    ...filter,
    ...worktrees,
    ...quickActions,
    ...sections,
    ...selectionLifecycle,
    ...selectionActions,
    ...taskUrl
  })
  const handleSelectFile = useCallback(
    (relativePath: string) => {
      const worktree = storeState.allWorktrees.find(
        (entry) => entry.id === storeState.activeWorktreeId
      )
      if (!worktree || !storeState.activeWorktreeId) {
        return
      }
      storeState.closeModal()
      storeState.openFile({
        filePath: joinPath(worktree.path, relativePath),
        relativePath,
        worktreeId: storeState.activeWorktreeId,
        language: detectLanguage(relativePath),
        mode: 'edit'
      })
    },
    [storeState]
  )
  const handleQuickAi = useCallback(() => {
    const result = launchQuickAi({ query: localState.query })
    if (result.launched) {
      storeState.closeModal()
      return
    }
    toast.error(
      result.reason === 'no-agent-available'
        ? translate(
            'auto.components.WorktreeJumpPalette.quickAiNoAgent',
            'No AI agent is available to ask.'
          )
        : translate(
            'auto.components.WorktreeJumpPalette.quickAiNoWorkspace',
            'Open a workspace first to ask an agent.'
          )
    )
  }, [localState.query, storeState])

  return {
    ...storeState,
    ...localState,
    ...taskUrl,
    ...filter,
    ...worktrees,
    ...openTabs,
    ...recentTabs,
    ...projectTargets,
    ...quickActions,
    ...sections,
    ...listEntries,
    ...selectionLifecycle,
    ...filePalette,
    handleSelectFile,
    handleQuickAi,
    handlePaletteInputKeyDown,
    ...selectionActions,
    paletteNowMs: worktrees.hasQuery ? paletteSearchContext.nowMs : storeState.paletteNowMs,
    emojiInput,
    ...createAction
  }
}

export type WorktreeJumpPaletteController = ReturnType<typeof useWorktreeJumpPaletteController>
