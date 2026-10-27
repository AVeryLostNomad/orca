import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useCommandBarFiles } from '@/components/cmd-j/use-command-bar-files'
import {
  launchQuickAi,
  shouldShowQuickAiRow,
  type QuickAiMatchCounts
} from '@/components/cmd-j/quick-ai'
import { parseCommandBarMode } from '@/components/cmd-j/command-bar-mode'
import { openQuickOpenFile } from '@/components/quick-open-file-navigation'
import { translate } from '@/i18n/i18n'
import type { FilePaletteItem } from './worktree-jump-palette-model'

/** File matches (Cmd+P mode or alongside a query) and the quick-AI fallback row. */
export function useWorktreeJumpPaletteFileMode({
  visible,
  modalData,
  workspaces,
  activeWorktreeId,
  closeModal,
  query,
  deferredQuery,
  hasUrlIntent,
  hasQuery,
  isLoading,
  otherMatchCounts
}: {
  visible: boolean
  modalData: Record<string, unknown> | null
  workspaces: readonly { id: string; path: string }[]
  activeWorktreeId: string | null
  closeModal: () => void
  query: string
  deferredQuery: string
  hasUrlIntent: boolean
  hasQuery: boolean
  isLoading: boolean
  otherMatchCounts: Omit<QuickAiMatchCounts, 'files'>
}) {
  const [fileModeCleared, setFileModeCleared] = useState(false)
  useEffect(() => {
    setFileModeCleared(false)
  }, [modalData])
  const paletteMode = fileModeCleared ? 'all' : parseCommandBarMode(modalData)
  const activeWorktreePath = workspaces.find((entry) => entry.id === activeWorktreeId)?.path ?? null
  const {
    items: fileMatches,
    loading: filesLoading,
    loadError: filesLoadError,
    target: fileQueryTarget
  } = useCommandBarFiles({
    enabled: visible && activeWorktreeId !== null,
    worktreeId: activeWorktreeId,
    worktreePath: activeWorktreePath,
    query: deferredQuery,
    limit: paletteMode === 'files' ? 50 : 6
  })
  const fileItems = useMemo<FilePaletteItem[]>(
    () =>
      activeWorktreeId !== null && (paletteMode === 'files' || hasQuery)
        ? fileMatches.map((match) => ({ id: `file:${match.path}`, type: 'file', path: match.path }))
        : [],
    [fileMatches, paletteMode, activeWorktreeId, hasQuery]
  )
  const { worktrees, openTabs, middle, projectTargets } = otherMatchCounts
  const showQuickAi = useMemo(
    () =>
      shouldShowQuickAiRow({
        query: deferredQuery,
        matchCounts:
          paletteMode === 'files'
            ? { worktrees: 0, openTabs: 0, middle: 0, projectTargets: 0, files: fileItems.length }
            : { worktrees, openTabs, middle, projectTargets, files: fileItems.length },
        hasUrlIntent,
        eligible: activeWorktreeId !== null && !isLoading
      }),
    [
      fileItems.length,
      deferredQuery,
      openTabs,
      paletteMode,
      projectTargets,
      middle,
      activeWorktreeId,
      hasUrlIntent,
      isLoading,
      worktrees
    ]
  )
  const clearFileMode = useCallback(() => setFileModeCleared(true), [])
  const handleSelectFile = useCallback(
    (selectedPath: string) => {
      const worktreeId = activeWorktreeId
      if (!worktreeId || !activeWorktreePath) {
        return
      }
      const rawQuery = deferredQuery
      closeModal()
      // Why: shares Quick Open's opener so runtime/SSH hosts, absolute paths and :line targets work.
      void openQuickOpenFile(
        selectedPath,
        worktreeId,
        activeWorktreePath,
        fileQueryTarget,
        rawQuery
      ).catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error))
      })
    },
    [activeWorktreeId, activeWorktreePath, closeModal, deferredQuery, fileQueryTarget]
  )
  const handleQuickAi = useCallback(() => {
    const result = launchQuickAi({ query })
    if (result.launched) {
      closeModal()
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
  }, [closeModal, query])

  return {
    filePalette: { fileItems, filesLoading, filesLoadError, paletteMode, showQuickAi },
    clearFileMode,
    handleSelectFile,
    handleQuickAi
  }
}
